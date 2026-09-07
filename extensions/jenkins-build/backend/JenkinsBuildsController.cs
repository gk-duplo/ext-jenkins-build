using Duplo.Ai.DataManagement.Controllers.User.Resource;
using Duplo.Ai.DataManagement.Models;
using Duplo.Ai.Model.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Duplo.Extension.JenkinsBuild;

/// <summary>
/// Workspace-scoped REST controller. The base gives full CRUD + <c>POST {id}/results</c> +
/// <c>POST {id}/status</c> at <c>…/environment/extensions/jenkins-builds</c>; this adds the custom
/// endpoints the Add form and the Result view's Logs/Artifacts tabs need (reference/05-custom-actions.md).
/// Jenkins credentials are resolved by delegating to <see cref="JenkinsBuildService"/> — a bare
/// ApplicationPart controller does not reliably resolve host singletons like IScopeCredentials via
/// constructor injection (reference/10-sdk-api.md "No auxiliary DI on hot-load"); only the extension's
/// registered service/worker get the composite child→root container. Inject the concrete service type
/// (registered as itself, not just its IEntityService/IResourceService aliases) to reach those methods.
/// </summary>
[ApiController]
[Route("v1/aiservicedesk/user/data/workspaces/{workspaceId}/environment/extensions/jenkins-builds")]
public class JenkinsBuildsController : ResourcesController<JenkinsBuild, JenkinsBuildSpec, JenkinsBuildResult>
{
    private readonly IEntityService<JenkinsBuild> _service;
    private readonly JenkinsBuildService _jenkinsService;

    public JenkinsBuildsController(
        IEntityService<JenkinsBuild> service,
        JenkinsBuildService jenkinsService,
        ILogger<JenkinsBuildsController> logger)
        : base(service, logger)
    {
        _service = service;
        _jenkinsService = jenkinsService;
    }

    public record ConsoleResponse(string Text, bool Building, int? NextStart);

    // ── Add-form support: job list + job parameters, resolved from a scope with no entity yet ────────

    /// <summary>Jenkins jobs available on the scope's server — populates the Add form's job dropdown when
    /// the user changes the scope selection.</summary>
    [HttpGet("jobs")]
    public async Task<IActionResult> ListJobs(string workspaceId, [FromQuery] string scopeId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(scopeId))
        {
            return BadRequest(ApiResponse<object>.ErrorResult("Invalid request", "scopeId is required."));
        }
        try
        {
            var (baseUrl, username, token) = await _jenkinsService.ResolveScopeAsync(scopeId, ct);
            var jobs = await JenkinsClient.ListJobsAsync(JenkinsClient.Shared, baseUrl, username, token, ct);
            return Ok(ApiResponse<IReadOnlyList<JenkinsClient.JenkinsJob>>.SuccessResult(jobs));
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ApiResponse<object>.ErrorResult("Invalid request", ex.Message));
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(502, ApiResponse<object>.ErrorResult("Upstream error", ex.Message));
        }
    }

    /// <summary>The selected job's parameter definitions — feeds the Add form's dynamic parameter fields.</summary>
    [HttpGet("jobs/{jobName}/parameters")]
    public async Task<IActionResult> GetJobParameters(
        string workspaceId, string jobName, [FromQuery] string scopeId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(scopeId))
        {
            return BadRequest(ApiResponse<object>.ErrorResult("Invalid request", "scopeId is required."));
        }
        try
        {
            var (baseUrl, username, token) = await _jenkinsService.ResolveScopeAsync(scopeId, ct);
            var parameters = await JenkinsClient.GetJobParametersAsync(JenkinsClient.Shared, baseUrl, jobName, username, token, ct);
            return Ok(ApiResponse<IReadOnlyList<JenkinsClient.JenkinsJobParameter>>.SuccessResult(parameters));
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ApiResponse<object>.ErrorResult("Invalid request", ex.Message));
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(502, ApiResponse<object>.ErrorResult("Upstream error", ex.Message));
        }
    }

    // ── Result view support: console log tail + artifact proxy (reference/05-custom-actions.md §6) ────

    /// <summary>Tails the build's console log for the Logs tab, sliced server-side from <paramref name="start"/>
    /// to match the platform's usual polling-log-viewer contract.</summary>
    [HttpGet("{id}/console")]
    public async Task<IActionResult> Console(
        string workspaceId, string id, [FromQuery] int start = 0, CancellationToken ct = default)
    {
        var entity = await _service.GetByIdAsync(id, ct);
        if (entity is null || entity.OwnerWorkspaceId != workspaceId)
        {
            return NotFound();
        }
        var buildUrl = entity.Result?.BuildUrl;
        if (string.IsNullOrEmpty(buildUrl))
        {
            return Ok(ApiResponse<ConsoleResponse>.SuccessResult(new ConsoleResponse("", false, 0)));
        }
        try
        {
            var (_, username, token) = await _jenkinsService.ResolveEntityScopeAsync(entity, ct);
            var full = await JenkinsClient.GetConsoleTextAsync(JenkinsClient.Shared, buildUrl, username, token, ct);
            var clampedStart = Math.Clamp(start, 0, full.Length);
            var slice = full[clampedStart..];
            var building = entity.Result?.BuildStatus is "QUEUED" or "BUILDING";
            return Ok(ApiResponse<ConsoleResponse>.SuccessResult(new ConsoleResponse(slice, building, full.Length)));
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ApiResponse<object>.ErrorResult("Invalid request", ex.Message));
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(502, ApiResponse<object>.ErrorResult("Upstream error", ex.Message));
        }
    }

    /// <summary>Proxies one artifact's raw content from Jenkins. Text-like extensions get their real
    /// content-type when Jenkins doesn't provide one narrow enough; everything else streams as-is.</summary>
    [HttpGet("{id}/artifacts/{*relativePath}")]
    public async Task<IActionResult> GetArtifact(
        string workspaceId, string id, string relativePath, CancellationToken ct = default)
    {
        var entity = await _service.GetByIdAsync(id, ct);
        if (entity is null || entity.OwnerWorkspaceId != workspaceId)
        {
            return NotFound();
        }
        var buildUrl = entity.Result?.BuildUrl;
        if (string.IsNullOrEmpty(buildUrl))
        {
            return NotFound();
        }
        try
        {
            var (_, username, token) = await _jenkinsService.ResolveEntityScopeAsync(entity, ct);
            var (bytes, contentType) = await JenkinsClient.GetArtifactContentAsync(
                JenkinsClient.Shared, buildUrl, relativePath, username, token, ct);
            var effectiveType = string.IsNullOrEmpty(contentType) ? GuessContentType(relativePath) : contentType;
            return File(bytes, effectiveType, Path.GetFileName(relativePath));
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ApiResponse<object>.ErrorResult("Invalid request", ex.Message));
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(502, ApiResponse<object>.ErrorResult("Upstream error", ex.Message));
        }
    }

    // ── Content-type helper ─────────────────────────────────────────────────────────────────────────

    private static readonly HashSet<string> TextExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".txt", ".log", ".json", ".xml", ".yml", ".yaml", ".md", ".csv",
    };

    private static string GuessContentType(string relativePath)
    {
        var ext = Path.GetExtension(relativePath);
        return TextExtensions.Contains(ext) ? "text/plain" : "application/octet-stream";
    }
}
