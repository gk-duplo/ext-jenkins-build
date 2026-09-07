using Duplo.Ai.DataManagement.Services.Workers;
using Duplo.Ai.Model;
using Duplo.Ai.Studio.Extensibility.Infra;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;

namespace Duplo.Extension.JenkinsBuild;

/// <summary>
/// Background worker that triggers a Jenkins job and polls it to completion. The base
/// <see cref="ResourceWorkerBase{TResource,TSpec,TResult}"/> drives the tick loop, status transitions,
/// retries, and the deprovision path; this class supplies the four Jenkins operations plus a three-phase
/// <see cref="ApplyAsync"/> that must be tick-safe/idempotent — the base re-invokes it every tick until the
/// resource reaches a terminal state, so every branch is chosen from what is already recorded on
/// <c>entity.Result</c> (never "have I already run this tick" state).
///
/// Phase 1 (no queue-item-url, no BuildNumber): trigger the build, stamp the queue item URL into
///          Result.ExtraConfigs (implementation-only metadata — reference/03-base-classes.md), status QUEUED.
/// Phase 2 (queue-item-url recorded, no BuildNumber yet): poll the queue item; once Jenkins assigns a real
///          build, stamp BuildNumber/BuildUrl/StartedAt, status BUILDING.
/// Phase 3 (BuildNumber known): poll the build; while building, just refresh status; once finished, map
///          Jenkins' result to BuildStatus, fetch artifacts, and return normally so the base flips the
///          RESOURCE to Complete — even when BuildStatus is FAILURE, because this resource's job is
///          "trigger and observe", not "the build must succeed". Only plumbing errors (no scope, Jenkins
///          unreachable, a genuinely aborted/cancelled queue item) throw to land the resource in Failed.
/// </summary>
public class JenkinsBuildWorker : ResourceWorkerBase<JenkinsBuild, JenkinsBuildSpec, JenkinsBuildResult>
{
    private const string QueueItemUrlKey = "queueItemUrl";

    private readonly ILogger<JenkinsBuildWorker> _log;

    public JenkinsBuildWorker(IServiceScopeFactory scopeFactory, ILogger<JenkinsBuildWorker> logger, IConfiguration? config = null)
        : base(scopeFactory, logger, config)
    {
        _log = logger;
    }

    protected override async Task ApplyAsync(JenkinsBuild e, IServiceProvider scope, CancellationToken ct)
    {
        e.Result ??= new JenkinsBuildResult();
        var jobName = e.Spec?.JobName;
        if (string.IsNullOrWhiteSpace(jobName))
        {
            throw new InvalidOperationException("JenkinsBuild has no JobName set.");
        }

        var queueItemUrl = GetQueueItemUrl(e.Result);
        var haveBuildNumber = e.Result.BuildNumber is not null;

        if (queueItemUrl is null && !haveBuildNumber)
        {
            await TriggerAsync(e, scope, jobName!, ct);
            return; // don't block the tick — the next tick starts polling the queue item.
        }

        if (!haveBuildNumber)
        {
            await PollQueueAsync(e, scope, queueItemUrl!, ct);
            return; // still queued or just resolved — either way, let the tick loop continue.
        }

        await PollBuildAsync(e, scope, ct);
    }

    // ── Phase 1 — trigger ────────────────────────────────────────────────────────────────────────────

    private async Task TriggerAsync(JenkinsBuild e, IServiceProvider scope, string jobName, CancellationToken ct)
    {
        var (baseUrl, username, token) = await ResolveCredentialsAsync(e, scope, ct);
        var queueItemUrl = await JenkinsClient.TriggerBuildAsync(
            JenkinsClient.Shared, baseUrl, jobName, e.Spec?.Parameters, username, token, ct);

        e.Result!.ExtraConfigs ??= new BsonDocument();
        e.Result.ExtraConfigs[QueueItemUrlKey] = queueItemUrl;
        e.Result.JobName = jobName;
        e.Result.JobUrl = $"{JenkinsClient.NormalizeBase(baseUrl)}job/{Uri.EscapeDataString(jobName)}/";
        e.Result.BuildStatus = "QUEUED";
        await SaveProgressAsync(scope, e, "Build queued", ct);
    }

    // ── Phase 2 — resolve the queued build to a real build number ──────────────────────────────────

    private async Task PollQueueAsync(JenkinsBuild e, IServiceProvider scope, string queueItemUrl, CancellationToken ct)
    {
        var (_, username, token) = await ResolveCredentialsAsync(e, scope, ct);
        var item = await JenkinsClient.GetQueueItemAsync(JenkinsClient.Shared, queueItemUrl, username, token, ct);

        if (item.Cancelled)
        {
            e.Result!.BuildStatus = "ABORTED";
            await SaveProgressAsync(scope, e, "Build was cancelled while queued", ct);
            // No explicit "fail now" hook beyond exceptions for a worker mid-apply (reference/04-hooks.md) —
            // throwing surfaces the failure on the resource rather than silently landing on Complete.
            throw new InvalidOperationException($"Jenkins queue item for '{e.Spec?.JobName}' was cancelled.");
        }

        if (item.BuildNumber is null || string.IsNullOrEmpty(item.BuildUrl))
        {
            return; // still queued — next tick re-checks.
        }

        e.Result!.BuildNumber = item.BuildNumber;
        e.Result.BuildUrl = JenkinsClient.NormalizeBase(item.BuildUrl!);
        e.Result.BuildStatus = "BUILDING";
        e.Result.StartedAt = DateTime.UtcNow;
        await SaveProgressAsync(scope, e, $"Build #{item.BuildNumber} started", ct);
    }

    // ── Phase 3 — poll the running build to completion ──────────────────────────────────────────────

    private async Task PollBuildAsync(JenkinsBuild e, IServiceProvider scope, CancellationToken ct)
    {
        var (_, username, token) = await ResolveCredentialsAsync(e, scope, ct);
        var buildUrl = e.Result!.BuildUrl
            ?? throw new InvalidOperationException("JenkinsBuild has a BuildNumber but no BuildUrl.");

        var info = await JenkinsClient.GetBuildInfoAsync(JenkinsClient.Shared, buildUrl, username, token, ct);
        if (info.Building)
        {
            if (e.Result.BuildStatus != "BUILDING")
            {
                e.Result.BuildStatus = "BUILDING";
                await SaveProgressAsync(scope, e, $"Build #{e.Result.BuildNumber} running", ct);
            }
            return; // worker re-ticks until Jenkins reports finished.
        }

        e.Result.BuildStatus = MapJenkinsResult(info.Result);
        e.Result.FinishedAt = DateTime.UtcNow;
        try
        {
            var artifacts = await JenkinsClient.GetArtifactsAsync(JenkinsClient.Shared, buildUrl, username, token, ct);
            e.Result.Artifacts = artifacts
                .Select(a => new JenkinsArtifact { FileName = a.FileName, RelativePath = a.RelativePath })
                .ToList();
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to fetch artifact list for build {BuildUrl}", buildUrl);
        }
        await SaveProgressAsync(scope, e, $"Build #{e.Result.BuildNumber} finished: {e.Result.BuildStatus}", ct);
        // Returning normally here lets the base flip the RESOURCE to Complete (reference/04-hooks.md) even
        // when BuildStatus is FAILURE/ABORTED/UNSTABLE — the Result field is where the real outcome shows;
        // this resource's job was to trigger and observe the build, which it did successfully.
    }

    private static string MapJenkinsResult(string? jenkinsResult) => jenkinsResult switch
    {
        "SUCCESS" => "SUCCESS",
        "FAILURE" => "FAILURE",
        "ABORTED" => "ABORTED",
        "UNSTABLE" => "UNSTABLE",
        _ => "UNSTABLE",
    };

    private static string? GetQueueItemUrl(JenkinsBuildResult? result)
    {
        if (result?.ExtraConfigs is null || !result.ExtraConfigs.TryGetValue(QueueItemUrlKey, out var v))
        {
            return null;
        }
        return v.IsString ? v.AsString : null;
    }

    // ── Deprovision seam (reference/11-deprovisioning.md — worker path) ────────────────────────────

    protected override Task VerifyDriftAsync(JenkinsBuild e, IServiceProvider scope, CancellationToken ct)
        => Task.CompletedTask; // a build run is one-shot — nothing to drift-check.

    protected override async Task DeleteSubResourcesAsync(JenkinsBuild e, IServiceProvider scope, CancellationToken ct)
    {
        var status = e.Result?.BuildStatus;
        if (status is not ("QUEUED" or "BUILDING"))
        {
            return; // already terminal — nothing running to abort.
        }
        try
        {
            var (baseUrl, username, token) = await ResolveCredentialsAsync(e, scope, ct);
            if (!string.IsNullOrEmpty(e.Result?.BuildUrl))
            {
                await JenkinsClient.StopBuildAsync(JenkinsClient.Shared, e.Result!.BuildUrl!, username, token, ct);
            }
            else
            {
                var queueItemUrl = GetQueueItemUrl(e.Result);
                var queueId = JenkinsClient.ExtractQueueId(queueItemUrl);
                if (queueId is not null)
                {
                    await JenkinsClient.CancelQueueItemAsync(JenkinsClient.Shared, baseUrl, queueId.Value, username, token, ct);
                }
            }
        }
        catch (Exception ex)
        {
            // Best-effort: Jenkins may already be done, or the scope may be gone — never block deprovision on this.
            _log.LogWarning(ex, "Best-effort abort of Jenkins build failed for {Id}", e.Id);
        }
    }

    protected override Task<bool> WaitForDeletionAsync(JenkinsBuild e, IServiceProvider scope, CancellationToken ct)
        => Task.FromResult(true); // nothing further to wait for once the abort call is attempted.

    // ── Shared credential resolution ────────────────────────────────────────────────────────────────

    private static async Task<(string BaseUrl, string Username, string Token)> ResolveCredentialsAsync(
        JenkinsBuild e, IServiceProvider scope, CancellationToken ct)
    {
        var creds = scope.GetRequiredService<IScopeCredentials>();
        var resolved = await creds.RequireOfCategoryAsync(
            e.Spec?.ScopeIds ?? new List<string>(), ProviderCategory.other, "Attach the Jenkins scope.", ct);
        var baseUrl = resolved.Provider.AccountId
            ?? throw new InvalidOperationException("Jenkins scope has no base URL (Provider.AccountId).");
        var username = resolved.Data.TryGetValue("username", out var u) ? u : null;
        var token = resolved.Data.TryGetValue("token", out var t) ? t : null;
        if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(token))
        {
            throw new InvalidOperationException("Jenkins scope is missing username/token credentials.");
        }
        return (baseUrl, username!, token!);
    }
}
