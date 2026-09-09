using Duplo.Ai.DataManagement.Controllers.User.Resource;
using Duplo.Ai.Model.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Duplo.Extension.MathOps;

/// <summary>Workspace-scoped REST controller for the worker-backed MathOps.</summary>
[ApiController]
[Route("v1/aiservicedesk/user/data/workspaces/{workspaceId}/environment/extensions/math-ops")]
public class MathOpsController : ResourcesController<MathOps, MathOpsSpec, MathOpsResult>
{
    public MathOpsController(IEntityService<MathOps> service, ILogger<MathOpsController> logger)
        : base(service, logger)
    {
    }
}
