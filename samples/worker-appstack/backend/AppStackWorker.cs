using Duplo.Ai.DataManagement.Services.Workers;
using Duplo.Ai.Studio.Extensibility.Infra;
using k8s;
using k8s.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Duplo.Extension.AppStack;

/// <summary>
/// Background worker that reconciles each <see cref="AppStack"/> into a Kubernetes Deployment + Service.
/// The base <see cref="ResourceWorkerBase{TResource,TSpec,TResult}"/> drives the tick loop, status
/// transitions, retries, and the deprovision path; this class supplies the four cluster operations. It
/// resolves the SDK's <see cref="IScopeClientFactory"/> from the per-tick DI scope.
/// </summary>
public class AppStackWorker : ResourceWorkerBase<AppStack, AppStackSpec, AppStackResult>
{
    public AppStackWorker(IServiceScopeFactory scopeFactory, ILogger<AppStackWorker> logger, IConfiguration? config = null)
        : base(scopeFactory, logger, config)
    {
    }

    // Apply Deployment then Service (dependency order).
    protected override async Task ApplyAsync(AppStack e, IServiceProvider scope, CancellationToken ct)
    {
        var (client, ns) = await ResolveAsync(e, scope, ct);
        var labels = new Dictionary<string, string> { ["app"] = e.Name };

        var deployment = new V1Deployment
        {
            Metadata = new V1ObjectMeta { Name = e.Name, NamespaceProperty = ns },
            Spec = new V1DeploymentSpec
            {
                Replicas = e.Spec?.Replicas ?? 1,
                Selector = new V1LabelSelector { MatchLabels = labels },
                Template = new V1PodTemplateSpec
                {
                    Metadata = new V1ObjectMeta { Labels = labels },
                    Spec = new V1PodSpec
                    {
                        Containers = new List<V1Container>
                        {
                            new V1Container { Name = e.Name, Image = e.Spec?.Image ?? "nginx:latest" },
                        },
                    },
                },
            },
        };
        await client.AppsV1.CreateNamespacedDeploymentAsync(deployment, ns, cancellationToken: ct);

        var service = new V1Service
        {
            Metadata = new V1ObjectMeta { Name = e.Name, NamespaceProperty = ns },
            Spec = new V1ServiceSpec
            {
                Selector = labels,
                Ports = new List<V1ServicePort> { new V1ServicePort(80) },
            },
        };
        await client.CoreV1.CreateNamespacedServiceAsync(service, ns, cancellationToken: ct);
    }

    // No-op drift check for the demo.
    protected override Task VerifyDriftAsync(AppStack e, IServiceProvider scope, CancellationToken ct)
        => Task.CompletedTask;

    // Delete in reverse dependency order (Service then Deployment).
    protected override async Task DeleteSubResourcesAsync(AppStack e, IServiceProvider scope, CancellationToken ct)
    {
        var (client, ns) = await ResolveAsync(e, scope, ct);
        await client.CoreV1.DeleteNamespacedServiceAsync(e.Name, ns, cancellationToken: ct);
        await client.AppsV1.DeleteNamespacedDeploymentAsync(e.Name, ns, cancellationToken: ct);
    }

    // Done once the Deployment is gone from the cluster.
    protected override async Task<bool> WaitForDeletionAsync(AppStack e, IServiceProvider scope, CancellationToken ct)
    {
        var (client, ns) = await ResolveAsync(e, scope, ct);
        var deps = await client.AppsV1.ListNamespacedDeploymentAsync(
            ns, fieldSelector: $"metadata.name={e.Name}", cancellationToken: ct);
        return deps.Items.Count == 0;
    }

    private static async Task<(IKubernetes client, string ns)> ResolveAsync(AppStack e, IServiceProvider scope, CancellationToken ct)
    {
        var factory = scope.GetRequiredService<IScopeClientFactory>();
        var k8s = await factory.GetKubernetesClientAsync(e.Spec?.ScopeIds ?? new List<string>(), ct);
        if (k8s is null) throw new InvalidOperationException("Attach a kubernetes scope to this resource.");
        return (k8s.Value.Client, e.Spec?.Namespace ?? "default");
    }
}
