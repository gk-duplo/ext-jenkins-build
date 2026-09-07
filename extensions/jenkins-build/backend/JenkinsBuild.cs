using Duplo.Ai.DataManagement.Interfaces;
using Duplo.Ai.DataManagement.Services;
using Duplo.Ai.Model;
using Duplo.Ai.Model.Attributes;
using Duplo.Ai.Model.Interfaces;
using Duplo.Ai.Model.Resource;
using Duplo.Ai.Studio.Extensibility.Infra;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using MongoDB.Bson.Serialization.Attributes;

namespace Duplo.Extension.JenkinsBuild;

// JenkinsBuild — WORKER-mode extension: trigger a Jenkins job and poll it to completion. Deterministic,
// no LLM/skill needed (see reference/04-hooks.md provisioning-mode table). The worker
// (JenkinsBuildWorker) does all the Jenkins HTTP calls via the shared no-DI JenkinsClient helper.

/// <summary>User-supplied inputs: which Jenkins job to run, with which build parameters. ScopeIds
/// (inherited from BaseSpec) carries the Jenkins "other" scope selected on the Add form.</summary>
[BsonIgnoreExtraElements]
public class JenkinsBuildSpec : BaseSpec
{
    /// <summary>The Jenkins job name to trigger (from the job dropdown, populated by GET jobs?scopeId=).</summary>
    public string? JobName { get; set; }

    /// <summary>Build parameters keyed by Jenkins parameter name, from the dynamic parameter fields.</summary>
    public Dictionary<string, string>? Parameters { get; set; }
}

/// <summary>One artifact Jenkins reports on the finished build.</summary>
[BsonIgnoreExtraElements]
public class JenkinsArtifact
{
    public string? FileName { get; set; }
    public string? RelativePath { get; set; }
}

/// <summary>Build outputs the worker writes back as it progresses through queued → building → terminal.</summary>
[BsonIgnoreExtraElements]
public class JenkinsBuildResult : BaseResult
{
    /// <summary>Echoed job name.</summary>
    public string? JobName { get; set; }

    /// <summary>Direct Jenkins job URL (base + job/{jobName}/).</summary>
    public string? JobUrl { get; set; }

    public int? BuildNumber { get; set; }

    /// <summary>Direct Jenkins build URL (base + job/{jobName}/{buildNumber}/).</summary>
    public string? BuildUrl { get; set; }

    /// <summary>QUEUED | BUILDING | SUCCESS | FAILURE | ABORTED | UNSTABLE.</summary>
    public string? BuildStatus { get; set; }

    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }

    public List<JenkinsArtifact>? Artifacts { get; set; }

    // Implementation-only metadata lives in the inherited BaseResult.ExtraConfigs (BsonDocument) — the
    // Jenkins queue-item URL is stamped there under "queueItemUrl" so the worker can resolve the real
    // build number on a later tick. Not a Spec/Result field: it is never rendered in the UI.
}

/// <summary>The entity — own Mongo collection; origin type/sub-type drive the ticket origin (Worker mode
/// maps no skill, so these only identify the resource for menus/routes).</summary>
[BsonCollection("extension_jenkinsbuilds")]
[BsonIgnoreExtraElements]
public class JenkinsBuild : ResourceBase<JenkinsBuildSpec, JenkinsBuildResult>
{
    public override string GetTicketOriginType() => "JenkinsBuild";
    public override string GetTicketOriginSubType() => "jenkins-build";
}

/// <summary>No-op hooks (framework default). See reference/04-hooks.md.</summary>
public class JenkinsBuildHooks : DefaultEntityHooks<JenkinsBuild>
{
}

/// <summary>
/// No skill mapping → returning <see cref="ProvisioningMode.Worker"/> routes create/update/delete through
/// the background <see cref="JenkinsBuildWorker"/>, which owns all the Jenkins HTTP calls.
/// </summary>
public class JenkinsBuildService : ResourceServiceBase<JenkinsBuild, JenkinsBuildSpec, JenkinsBuildResult>
{
    // Host singletons (IScopeCredentials) inject reliably here — the composite child→root container is
    // built around the extension's registered SERVICE, not around a bare ApplicationPart controller
    // (reference/10-sdk-api.md "No auxiliary DI on hot-load"). The controller therefore delegates every
    // Jenkins-scope-resolving call to a method on this service instead of injecting IScopeCredentials itself.
    private readonly IScopeCredentials _scopeCredentials;

    public JenkinsBuildService(
        IRepository<JenkinsBuild> repository,
        ILogger<JenkinsBuildService> logger,
        IServiceScopeFactory scopeFactory,
        IHttpContextAccessor httpContextAccessor,
        IScopeCredentials scopeCredentials)
        : base(repository, logger, scopeFactory, httpContextAccessor)
    {
        _scopeCredentials = scopeCredentials;
    }

    protected override ProvisioningMode NoSkillsFallbackMode => ProvisioningMode.Worker;

    protected override async Task ValidateSpecAsync(JenkinsBuildSpec spec, bool isUpdate, JenkinsBuildSpec? existingSpec, CancellationToken ct)
    {
        await base.ValidateSpecAsync(spec, isUpdate, existingSpec, ct);
        if (spec.ScopeIds is null || spec.ScopeIds.Count == 0)
            throw new ArgumentException("A Jenkins scope is required — attach one to run and poll the build.");
        if (string.IsNullOrWhiteSpace(spec.JobName))
            throw new ArgumentException("A Jenkins job is required.");
    }

    /// <summary>Resolves Jenkins base URL + credentials for an arbitrary scope id (Add-form job/parameter
    /// lookups, which run before any entity exists).</summary>
    public async Task<(string BaseUrl, string Username, string Token)> ResolveScopeAsync(string scopeId, CancellationToken ct)
    {
        var resolved = await _scopeCredentials.RequireOfCategoryAsync(
            new[] { scopeId }, ProviderCategory.other, "Attach the Jenkins scope.", ct);
        return ExtractCredentials(resolved);
    }

    /// <summary>Resolves Jenkins base URL + credentials from an existing entity's attached scope(s).</summary>
    public async Task<(string BaseUrl, string Username, string Token)> ResolveEntityScopeAsync(JenkinsBuild entity, CancellationToken ct)
    {
        var resolved = await _scopeCredentials.RequireOfCategoryAsync(
            entity.Spec?.ScopeIds ?? new List<string>(), ProviderCategory.other, "Attach the Jenkins scope.", ct);
        return ExtractCredentials(resolved);
    }

    private static (string BaseUrl, string Username, string Token) ExtractCredentials(ResolvedScope resolved)
    {
        var baseUrl = resolved.Provider.AccountId
            ?? throw new ArgumentException("Jenkins scope has no base URL (Provider.AccountId).");
        var username = resolved.Data.TryGetValue("username", out var u) ? u : null;
        var token = resolved.Data.TryGetValue("token", out var t) ? t : null;
        if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(token))
        {
            throw new ArgumentException("Jenkins scope is missing username/token credentials.");
        }
        return (baseUrl, username!, token!);
    }
}
