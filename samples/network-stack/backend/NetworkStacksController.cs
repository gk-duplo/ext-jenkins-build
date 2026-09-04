using Duplo.Ai.DataManagement.Controllers.User.Resource;
using Duplo.Ai.Model.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Duplo.Extension.NetworkStack;

/// <summary>
/// Workspace-scoped REST controller. The base gives full CRUD + <c>POST {id}/results</c> +
/// <c>POST {id}/status</c> at <c>…/environment/extensions/network-stacks</c>; this adds the
/// action-driven surface (plan/apply) and the run-history/log reads behind the Logs tab.
/// Plan and Apply are separate routes (not one body-dispatched endpoint) so each can carry its own
/// access-control policy later — an RBAC filter runs before model binding and cannot read the body.
/// </summary>
[ApiController]
[Route("v1/aiservicedesk/user/data/workspaces/{workspaceId}/environment/extensions/network-stacks")]
public class NetworkStacksController : ResourcesController<NetworkStack, NetworkStackSpec, NetworkStackResult>
{
    private readonly NetworkStackService _svc;

    public NetworkStacksController(
        IEntityService<NetworkStack> service, NetworkStackService svc,
        ILogger<NetworkStacksController> logger)
        : base(service, logger)
    {
        _svc = svc;
    }

    /// <summary>Preview: run a terraform plan. Mutates nothing; the agent runs it async on the resource's
    /// long-lived ticket. 202.</summary>
    [HttpPost("{id}/plan")]
    public Task<ActionResult> Plan(string workspaceId, string id, CancellationToken ct = default)
        => RunAction(workspaceId, id, "plan", ct);

    /// <summary>Apply the previewed changes — creates/reconfigures live AWS networking. Refused until a
    /// plan has succeeded (see NetworkStackResult.ApplyAllowed). 202.</summary>
    [HttpPost("{id}/apply")]
    public Task<ActionResult> Apply(string workspaceId, string id, CancellationToken ct = default)
        => RunAction(workspaceId, id, "apply", ct);

    private async Task<ActionResult> RunAction(string workspaceId, string id, string action, CancellationToken ct)
    {
        try
        {
            await _svc.TriggerActionAsync(workspaceId, id, action, ct);
            return Accepted();
        }
        catch (ArgumentException ex) { return BadRequest(ex.Message); }
        catch (KeyNotFoundException ex) { return NotFound(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(ex.Message); }
    }

    // ── Run history + logs (Logs tab) — read from the ticket workdir, see reference/05 §7 ────────────

    [HttpGet("{id}/plan-history")]
    public async Task<ActionResult<IReadOnlyList<NetworkStackRunMeta>>> GetPlanHistory(string workspaceId, string id, CancellationToken ct = default)
        => Ok(await _svc.GetPlanHistoryAsync(workspaceId, id, ct));

    [HttpGet("{id}/apply-history")]
    public async Task<ActionResult<IReadOnlyList<NetworkStackRunMeta>>> GetApplyHistory(string workspaceId, string id, CancellationToken ct = default)
        => Ok(await _svc.GetApplyHistoryAsync(workspaceId, id, ct));

    [HttpGet("{id}/plans/{runId}")]
    public async Task<ActionResult<NetworkStackRunDetail>> GetPlan(string workspaceId, string id, string runId, CancellationToken ct = default)
    {
        var d = await _svc.GetPlanAsync(workspaceId, id, runId, ct);
        return d is null ? NotFound() : Ok(d);
    }

    [HttpGet("{id}/applies/{runId}")]
    public async Task<ActionResult<NetworkStackRunDetail>> GetApply(string workspaceId, string id, string runId, CancellationToken ct = default)
    {
        var d = await _svc.GetApplyAsync(workspaceId, id, runId, ct);
        return d is null ? NotFound() : Ok(d);
    }
}
