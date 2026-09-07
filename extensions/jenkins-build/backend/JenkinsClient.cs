using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Duplo.Extension.JenkinsBuild;

/// <summary>
/// Plain, no-DI Jenkins REST helper shared by <see cref="JenkinsBuildWorker"/> and
/// <see cref="JenkinsBuildsController"/>. Per reference/10-sdk-api.md's "no auxiliary DI on hot-load"
/// gotcha, a extension cannot constructor-inject its own helper types — only host singletons
/// (IScopeCredentials, IScopeClientFactory) inject. So this is a static class taking
/// (HttpClient, baseUrl, username, token) per call instead of a registered service.
///
/// Auth: every call is HTTP Basic with (username, apiToken) resolved from the Jenkins "other" scope
/// (reference/07-scope-credentials.md). The token is never logged.
/// </summary>
public static class JenkinsClient
{
    /// <summary>
    /// Shared HttpClient instance. There is no host-registered IHttpClientFactory an extension can rely on
    /// injecting (reference/10-sdk-api.md's "no auxiliary DI on hot-load" gotcha covers extension-defined
    /// services; a framework HttpClientFactory registration isn't guaranteed either), so callers pass this
    /// static instance into every method below rather than creating a new HttpClient per call.
    /// </summary>
    public static readonly HttpClient Shared = new();

    public sealed record JenkinsJob(string Name, string Url);
    public sealed record JenkinsJobParameter(string Name, string? Type, string? DefaultValue);
    public sealed record JenkinsQueueItem(bool Cancelled, int? BuildNumber, string? BuildUrl);
    public sealed record JenkinsBuildInfo(bool Building, string? Result, long? Timestamp, long? Duration);
    public sealed record JenkinsArtifactEntry(string? FileName, string? RelativePath);

    /// <summary>Ensures a trailing slash so `{base}job/...` style concatenation never collapses a segment.</summary>
    public static string NormalizeBase(string url) => url.EndsWith('/') ? url : url + "/";

    private static void SetBasicAuth(HttpRequestMessage req, string username, string token)
    {
        var bytes = Encoding.UTF8.GetBytes($"{username}:{token}");
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(bytes));
    }

    private static string MakeAbsolute(string baseUrl, string maybeRelative)
    {
        if (Uri.TryCreate(maybeRelative, UriKind.Absolute, out _))
        {
            return maybeRelative;
        }
        return NormalizeBase(baseUrl) + maybeRelative.TrimStart('/');
    }

    public static async Task<IReadOnlyList<JenkinsJob>> ListJobsAsync(
        HttpClient http, string baseUrl, string username, string token, CancellationToken ct)
    {
        var url = $"{NormalizeBase(baseUrl)}api/json?tree=jobs[name,url]";
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        SetBasicAuth(req, username, token);
        using var resp = await http.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var jobs = new List<JenkinsJob>();
        if (doc.RootElement.TryGetProperty("jobs", out var arr))
        {
            foreach (var j in arr.EnumerateArray())
            {
                var name = j.TryGetProperty("name", out var n) ? n.GetString() : null;
                if (string.IsNullOrEmpty(name)) continue;
                var jobUrl = j.TryGetProperty("url", out var u) ? u.GetString() ?? "" : "";
                jobs.Add(new JenkinsJob(name!, jobUrl));
            }
        }
        return jobs;
    }

    public static async Task<IReadOnlyList<JenkinsJobParameter>> GetJobParametersAsync(
        HttpClient http, string baseUrl, string jobName, string username, string token, CancellationToken ct)
    {
        var url = $"{NormalizeBase(baseUrl)}job/{Uri.EscapeDataString(jobName)}/api/json"
            + "?tree=property[parameterDefinitions[name,type,defaultParameterValue[value]]]";
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        SetBasicAuth(req, username, token);
        using var resp = await http.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var result = new List<JenkinsJobParameter>();
        if (!doc.RootElement.TryGetProperty("property", out var props))
        {
            return result;
        }
        foreach (var p in props.EnumerateArray())
        {
            if (!p.TryGetProperty("parameterDefinitions", out var defs) || defs.ValueKind != JsonValueKind.Array)
            {
                continue;
            }
            foreach (var d in defs.EnumerateArray())
            {
                var name = d.TryGetProperty("name", out var n) ? n.GetString() : null;
                if (string.IsNullOrEmpty(name)) continue;
                var type = d.TryGetProperty("type", out var t) ? t.GetString() : null;
                string? defaultValue = null;
                if (d.TryGetProperty("defaultParameterValue", out var dv) && dv.ValueKind == JsonValueKind.Object
                    && dv.TryGetProperty("value", out var v))
                {
                    defaultValue = v.ValueKind switch
                    {
                        JsonValueKind.String => v.GetString(),
                        JsonValueKind.Number => v.GetRawText(),
                        JsonValueKind.True => "true",
                        JsonValueKind.False => "false",
                        _ => null,
                    };
                }
                result.Add(new JenkinsJobParameter(name!, type, defaultValue));
            }
        }
        return result;
    }

    /// <summary>
    /// Best-effort CSRF crumb. Many Jenkins configs require it on POST endpoints; some have CSRF
    /// protection disabled and the crumbIssuer 404s — that is NOT a failure, callers just skip the header.
    /// </summary>
    public static async Task<(string Field, string Value)?> TryGetCrumbAsync(
        HttpClient http, string baseUrl, string username, string token, CancellationToken ct)
    {
        try
        {
            var url = $"{NormalizeBase(baseUrl)}crumbIssuer/api/json";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            SetBasicAuth(req, username, token);
            using var resp = await http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                return null;
            }
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
            var field = doc.RootElement.TryGetProperty("crumbRequestField", out var f) ? f.GetString() : null;
            var value = doc.RootElement.TryGetProperty("crumb", out var c) ? c.GetString() : null;
            return string.IsNullOrEmpty(field) || string.IsNullOrEmpty(value) ? null : (field!, value!);
        }
        catch
        {
            // Crumb issuer unreachable/disabled — proceed without it.
            return null;
        }
    }

    /// <summary>
    /// Triggers the job (build or buildWithParameters) and returns the queue item URL from the response's
    /// Location header — Jenkins' trigger endpoints return no body.
    /// </summary>
    public static async Task<string> TriggerBuildAsync(
        HttpClient http, string baseUrl, string jobName, IReadOnlyDictionary<string, string>? parameters,
        string username, string token, CancellationToken ct)
    {
        var hasParams = parameters is { Count: > 0 };
        var path = hasParams ? "buildWithParameters" : "build";
        var url = $"{NormalizeBase(baseUrl)}job/{Uri.EscapeDataString(jobName)}/{path}";
        if (hasParams)
        {
            var query = string.Join("&", parameters!.Select(kv =>
                $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value ?? string.Empty)}"));
            url = $"{url}?{query}";
        }
        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        SetBasicAuth(req, username, token);
        var crumb = await TryGetCrumbAsync(http, baseUrl, username, token, ct);
        if (crumb is not null)
        {
            req.Headers.Add(crumb.Value.Field, crumb.Value.Value);
        }
        using var resp = await http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Failed to trigger Jenkins job '{jobName}': {(int)resp.StatusCode} {resp.ReasonPhrase}");
        }
        var location = resp.Headers.Location?.ToString();
        if (string.IsNullOrEmpty(location))
        {
            throw new InvalidOperationException(
                $"Jenkins did not return a queue item Location header for job '{jobName}'.");
        }
        return MakeAbsolute(baseUrl, location!);
    }

    /// <summary>Polls a queue item. BuildNumber/BuildUrl are null while still queued.</summary>
    public static async Task<JenkinsQueueItem> GetQueueItemAsync(
        HttpClient http, string queueItemUrl, string username, string token, CancellationToken ct)
    {
        var url = $"{NormalizeBase(queueItemUrl)}api/json";
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        SetBasicAuth(req, username, token);
        using var resp = await http.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var cancelled = doc.RootElement.TryGetProperty("cancelled", out var c) && c.ValueKind == JsonValueKind.True;
        int? number = null;
        string? buildUrl = null;
        if (doc.RootElement.TryGetProperty("executable", out var exec) && exec.ValueKind == JsonValueKind.Object)
        {
            if (exec.TryGetProperty("number", out var n) && n.ValueKind == JsonValueKind.Number)
            {
                number = n.GetInt32();
            }
            if (exec.TryGetProperty("url", out var u))
            {
                buildUrl = u.GetString();
            }
        }
        return new JenkinsQueueItem(cancelled, number, buildUrl);
    }

    public static async Task<JenkinsBuildInfo> GetBuildInfoAsync(
        HttpClient http, string buildUrl, string username, string token, CancellationToken ct)
    {
        var url = $"{NormalizeBase(buildUrl)}api/json";
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        SetBasicAuth(req, username, token);
        using var resp = await http.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var building = doc.RootElement.TryGetProperty("building", out var b) && b.ValueKind == JsonValueKind.True;
        var result = doc.RootElement.TryGetProperty("result", out var r) && r.ValueKind == JsonValueKind.String
            ? r.GetString() : null;
        long? timestamp = doc.RootElement.TryGetProperty("timestamp", out var ts) && ts.ValueKind == JsonValueKind.Number
            ? ts.GetInt64() : null;
        long? duration = doc.RootElement.TryGetProperty("duration", out var du) && du.ValueKind == JsonValueKind.Number
            ? du.GetInt64() : null;
        return new JenkinsBuildInfo(building, result, timestamp, duration);
    }

    public static async Task<IReadOnlyList<JenkinsArtifactEntry>> GetArtifactsAsync(
        HttpClient http, string buildUrl, string username, string token, CancellationToken ct)
    {
        var url = $"{NormalizeBase(buildUrl)}api/json";
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        SetBasicAuth(req, username, token);
        using var resp = await http.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var list = new List<JenkinsArtifactEntry>();
        if (doc.RootElement.TryGetProperty("artifacts", out var arts))
        {
            foreach (var a in arts.EnumerateArray())
            {
                list.Add(new JenkinsArtifactEntry(
                    a.TryGetProperty("fileName", out var f) ? f.GetString() : null,
                    a.TryGetProperty("relativePath", out var rp) ? rp.GetString() : null));
            }
        }
        return list;
    }

    /// <summary>Full console text — cheap to re-fetch on every poll (Jenkins always returns the whole log);
    /// callers that need progressive tailing (our own {id}/console) slice server-side.</summary>
    public static async Task<string> GetConsoleTextAsync(
        HttpClient http, string buildUrl, string username, string token, CancellationToken ct)
    {
        var url = $"{NormalizeBase(buildUrl)}consoleText";
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        SetBasicAuth(req, username, token);
        using var resp = await http.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadAsStringAsync(ct);
    }

    /// <summary>Fetches one artifact's raw bytes + Jenkins' reported content-type (if any).</summary>
    public static async Task<(byte[] Bytes, string? ContentType)> GetArtifactContentAsync(
        HttpClient http, string buildUrl, string relativePath, string username, string token, CancellationToken ct)
    {
        var encodedPath = string.Join("/", relativePath.Split('/').Select(Uri.EscapeDataString));
        var url = $"{NormalizeBase(buildUrl)}artifact/{encodedPath}";
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        SetBasicAuth(req, username, token);
        using var resp = await http.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
        var bytes = await resp.Content.ReadAsByteArrayAsync(ct);
        return (bytes, resp.Content.Headers.ContentType?.ToString());
    }

    /// <summary>Best-effort abort of a running build (deprovision seam). Idempotent — Jenkins 404s if the
    /// build already finished, which callers should swallow.</summary>
    public static async Task StopBuildAsync(
        HttpClient http, string buildUrl, string username, string token, CancellationToken ct)
    {
        var url = $"{NormalizeBase(buildUrl)}stop";
        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        SetBasicAuth(req, username, token);
        var crumb = await TryGetCrumbAsync(http, buildUrl, username, token, ct);
        if (crumb is not null)
        {
            req.Headers.Add(crumb.Value.Field, crumb.Value.Value);
        }
        using var resp = await http.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
    }

    /// <summary>Best-effort cancel of a still-queued build (deprovision seam, queued-but-not-started case).</summary>
    public static async Task CancelQueueItemAsync(
        HttpClient http, string baseUrl, int queueId, string username, string token, CancellationToken ct)
    {
        var url = $"{NormalizeBase(baseUrl)}queue/cancelItem?id={queueId}";
        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        SetBasicAuth(req, username, token);
        var crumb = await TryGetCrumbAsync(http, baseUrl, username, token, ct);
        if (crumb is not null)
        {
            req.Headers.Add(crumb.Value.Field, crumb.Value.Value);
        }
        using var resp = await http.SendAsync(req, ct);
        // Jenkins returns 404 for an already-started/removed queue item — not a failure for a best-effort abort.
        if (!resp.IsSuccessStatusCode && resp.StatusCode != System.Net.HttpStatusCode.NotFound)
        {
            resp.EnsureSuccessStatusCode();
        }
    }

    /// <summary>Extracts the numeric queue id from a queue item URL (".../queue/item/{id}/").</summary>
    public static int? ExtractQueueId(string? queueItemUrl)
    {
        if (string.IsNullOrEmpty(queueItemUrl))
        {
            return null;
        }
        var segments = queueItemUrl.TrimEnd('/').Split('/');
        return segments.Length > 0 && int.TryParse(segments[^1], out var id) ? id : null;
    }
}
