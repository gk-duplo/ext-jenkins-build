using Duplo.Ai.DataManagement.Interfaces;
using Duplo.Ai.DataManagement.Services;
using Duplo.Ai.Model.Attributes;
using Duplo.Ai.Model.Interfaces;
using Duplo.Ai.Model.Resource;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Duplo.Extension.ParentChild;

// PARENT resource of the parent/child sample. Same shape as the hello-world single resource — a
// first-class typed resource (ResourceBase + ResourceServiceBase + ResourcesController). The CHILD
// (HelloChild) links to it via a nested route + ParentRefSpec. See reference/08-parent-child-and-menus.md.

/// <summary>User-supplied inputs for a parent.</summary>
public class HelloParentSpec : BaseSpec
{
    public string? Title { get; set; }
}

/// <summary>Outputs the provisioning skill writes back.</summary>
public class HelloParentResult : BaseResult
{
    public string? Slug { get; set; }
}

[BsonCollection("extension_hello_parents")]
public class HelloParent : ResourceBase<HelloParentSpec, HelloParentResult>
{
    public override string GetTicketOriginType() => "HelloParent";
    public override string GetTicketOriginSubType() => "hello-parent";
}

public class HelloParentHooks : DefaultEntityHooks<HelloParent>
{
}

public class HelloParentService : ResourceServiceBase<HelloParent, HelloParentSpec, HelloParentResult>
{
    public HelloParentService(
        IRepository<HelloParent> repository,
        ILogger<HelloParentService> logger,
        IServiceScopeFactory scopeFactory,
        IHttpContextAccessor httpContextAccessor)
        : base(repository, logger, scopeFactory, httpContextAccessor)
    {
    }
}
