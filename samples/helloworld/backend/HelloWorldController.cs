using Duplo.Ai.DataManagement.Controllers.User.Resource;
using Duplo.Ai.Model.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Duplo.Extension.HelloWorld;

/// <summary>
/// The extension's own workspace-scoped REST controller. Inheriting
/// <see cref="ResourcesController{T,TSpec,TResult}"/> provides the full CRUD surface plus
/// <c>POST {id}/results</c>, <c>POST {id}/status</c>, and <c>GET view-template</c> — the same
/// endpoints every first-class resource exposes. The loader adds this assembly as an
/// ApplicationPart and refreshes routes, so this becomes live at
/// <c>.../environment/extensions/helloworlds</c> with no host restart.
/// </summary>
[ApiController]
[Route("v1/aiservicedesk/user/data/workspaces/{workspaceId}/environment/extensions/helloworlds")]
public class HelloWorldsController : ResourcesController<HelloWorld, HelloWorldSpec, HelloWorldResult>
{
    public HelloWorldsController(IEntityService<HelloWorld> service, ILogger<HelloWorldsController> logger)
        : base(service, logger)
    {
    }
}
