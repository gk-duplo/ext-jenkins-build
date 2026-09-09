using Duplo.Ai.DataManagement.Interfaces;
using Duplo.Ai.DataManagement.Services;
using Duplo.Ai.Model.Attributes;
using Duplo.Ai.Model.Interfaces;
using Duplo.Ai.Model.Resource;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using MongoDB.Bson.Serialization.Attributes;

namespace Duplo.Extension.MathOps;

[BsonIgnoreExtraElements]
public class MathOpsSpec : BaseSpec
{
    /// <summary>First operand.</summary>
    public double A { get; set; }

    /// <summary>Second operand.</summary>
    public double B { get; set; }
}

[BsonIgnoreExtraElements]
public class MathOpsResult : BaseResult
{
    /// <summary>A + B.</summary>
    public double Sum { get; set; }

    /// <summary>A - B.</summary>
    public double Difference { get; set; }

    /// <summary>A * B.</summary>
    public double Product { get; set; }

    /// <summary>A / B — null when B is 0.</summary>
    public double? Quotient { get; set; }

    /// <summary>A % B — null when B is 0.</summary>
    public double? Remainder { get; set; }

    /// <summary>A ^ B.</summary>
    public double Power { get; set; }

    /// <summary>min(A, B).</summary>
    public double Min { get; set; }

    /// <summary>max(A, B).</summary>
    public double Max { get; set; }

    /// <summary>(A + B) / 2.</summary>
    public double Average { get; set; }
}

[BsonCollection("extension_mathops")]
public class MathOps : ResourceBase<MathOpsSpec, MathOpsResult>
{
    public override string GetTicketOriginType() => "MathOps";
    public override string GetTicketOriginSubType() => "math-ops";
}

public class MathOpsHooks : DefaultEntityHooks<MathOps>
{
}

/// <summary>
/// No skill mapping → returning <see cref="ProvisioningMode.Worker"/> routes create/update through the
/// background <see cref="MathOpsWorker"/>. The worker holds the compute logic.
/// </summary>
public class MathOpsService : ResourceServiceBase<MathOps, MathOpsSpec, MathOpsResult>
{
    public MathOpsService(
        IRepository<MathOps> repository,
        ILogger<MathOpsService> logger,
        IServiceScopeFactory scopeFactory,
        IHttpContextAccessor httpContextAccessor)
        : base(repository, logger, scopeFactory, httpContextAccessor)
    {
    }

    protected override ProvisioningMode NoSkillsFallbackMode => ProvisioningMode.Worker;
}
