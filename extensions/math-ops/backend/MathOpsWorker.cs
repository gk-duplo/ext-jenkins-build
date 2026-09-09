using Duplo.Ai.DataManagement.Services.Workers;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.DependencyInjection;

namespace Duplo.Extension.MathOps;

/// <summary>
/// Background worker that "provisions" a <see cref="MathOps"/> by computing sum + product in process.
/// The base <see cref="ResourceWorkerBase{TResource,TSpec,TResult}"/> drives the tick loop, status
/// transitions, and retries; this class supplies the compute. Because there is no external system:
///   * <see cref="ApplyAsync"/> mutates <c>entity.Result</c> and calls <see cref="SaveProgressAsync"/> to
///     persist it (the base also re-persists Result on terminal success and flips Status to Complete);
///   * the delete/drift seams are no-ops and <see cref="WaitForDeletionAsync"/> returns true immediately.
/// </summary>
public class MathOpsWorker : ResourceWorkerBase<MathOps, MathOpsSpec, MathOpsResult>
{
    public MathOpsWorker(IServiceScopeFactory scopeFactory, ILogger<MathOpsWorker> logger, IConfiguration? config = null)
        : base(scopeFactory, logger, config)
    {
    }

    // Compute the result in process. Mutate entity.Result, then SaveProgressAsync persists it to the DB.
    // Quotient/Remainder stay null when B is 0 (safe skip).
    protected override async Task ApplyAsync(MathOps e, IServiceProvider scope, CancellationToken ct)
    {
        var a = e.Spec?.A ?? 0;
        var b = e.Spec?.B ?? 0;
        e.Result ??= new MathOpsResult();
        e.Result.Sum = a + b;
        e.Result.Difference = a - b;
        e.Result.Product = a * b;
        e.Result.Quotient = b == 0 ? null : a / b;
        e.Result.Remainder = b == 0 ? null : a % b;
        e.Result.Power = Math.Pow(a, b);
        e.Result.Min = Math.Min(a, b);
        e.Result.Max = Math.Max(a, b);
        e.Result.Average = (a + b) / 2.0;
        await SaveProgressAsync(scope, e, $"Computed 9 operations for A={a}, B={b}", ct);
    }

    // Nothing external to drift against.
    protected override Task VerifyDriftAsync(MathOps e, IServiceProvider scope, CancellationToken ct)
        => Task.CompletedTask;

    // Nothing external to delete.
    protected override Task DeleteSubResourcesAsync(MathOps e, IServiceProvider scope, CancellationToken ct)
        => Task.CompletedTask;

    // Nothing to wait for — deletion is instantaneous.
    protected override Task<bool> WaitForDeletionAsync(MathOps e, IServiceProvider scope, CancellationToken ct)
        => Task.FromResult(true);
}
