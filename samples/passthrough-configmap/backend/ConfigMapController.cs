using Duplo.Ai.DataManagement.Controllers.User.Resource;
using Duplo.Ai.Model.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Duplo.Extension.ConfigMapDemo;

/// <summary>Workspace-scoped REST controller for the passthrough ConfigMap demo.</summary>
[ApiController]
[Route("v1/aiservicedesk/user/data/workspaces/{workspaceId}/environment/extensions/configmapdemos")]
public class ConfigMapDemosController : ResourcesController<ConfigMapDemo, ConfigMapSpec, ConfigMapResult>
{
    public ConfigMapDemosController(IEntityService<ConfigMapDemo> service, ILogger<ConfigMapDemosController> logger)
        : base(service, logger)
    {
    }
}
