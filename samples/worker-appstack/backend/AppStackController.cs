using Duplo.Ai.DataManagement.Controllers.User.Resource;
using Duplo.Ai.Model.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Duplo.Extension.AppStack;

/// <summary>Workspace-scoped REST controller for the worker-backed AppStack demo.</summary>
[ApiController]
[Route("v1/aiservicedesk/user/data/workspaces/{workspaceId}/environment/extensions/appstacks")]
public class AppStacksController : ResourcesController<AppStack, AppStackSpec, AppStackResult>
{
    public AppStacksController(IEntityService<AppStack> service, ILogger<AppStacksController> logger)
        : base(service, logger)
    {
    }
}
