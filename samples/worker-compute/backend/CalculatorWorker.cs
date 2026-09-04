using Duplo.Ai.DataManagement.Services.Workers;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.DependencyInjection;

namespace Duplo.Extension.Calculator;

/// <summary>
/// Background worker that "provisions" a <see cref="Calculator"/> by computing sum + product in process.
/// The base <see cref="ResourceWorkerBase{TResource,TSpec,TResult}"/> drives the tick loop, status
/// transitions, and retries; this class supplies the compute. Because there is no external system:
///   * <see cref="ApplyAsync"/> mutates <c>entity.Result</c> and calls <see cref="SaveProgressAsync"/> to
///     persist it (the base also re-persists Result on terminal success and flips Status to Complete);
///   * the delete/drift seams are no-ops and <see cref="WaitForDeletionAsync"/> returns true immediately.
/// </summary>
public class CalculatorWorker : ResourceWorkerBase<Calculator, CalculatorSpec, CalculatorResult>
{
    public CalculatorWorker(IServiceScopeFactory scopeFactory, ILogger<CalculatorWorker> logger, IConfiguration? config = null)
        : base(scopeFactory, logger, config)
    {
    }

    // Compute the result in process. Mutate entity.Result, then SaveProgressAsync persists it to the DB.
    protected override async Task ApplyAsync(Calculator e, IServiceProvider scope, CancellationToken ct)
    {
        var a = e.Spec?.A ?? 0;
        var b = e.Spec?.B ?? 0;
        e.Result ??= new CalculatorResult();
        e.Result.Sum = a + b;
        e.Result.Product = a * b;
        await SaveProgressAsync(scope, e, $"Computed sum={e.Result.Sum}, product={e.Result.Product}", ct);
    }

    // Nothing external to drift against.
    protected override Task VerifyDriftAsync(Calculator e, IServiceProvider scope, CancellationToken ct)
        => Task.CompletedTask;

    // Nothing external to delete.
    protected override Task DeleteSubResourcesAsync(Calculator e, IServiceProvider scope, CancellationToken ct)
        => Task.CompletedTask;

    // Nothing to wait for — deletion is instantaneous.
    protected override Task<bool> WaitForDeletionAsync(Calculator e, IServiceProvider scope, CancellationToken ct)
        => Task.FromResult(true);
}
