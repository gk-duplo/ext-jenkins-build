import { Component, computed, input } from '@angular/core';
import { CommonLibComponentsModule } from '@duplocloud-internal/ng-common-lib';
import { NetworkStack } from '../network-stack.service';
import { StatusBadgeComponent } from './status-badge.component';

// Overview tab body: a mini-card grid of the stack's headline facts + per-module progress.
// NEVER a dead empty state — until the result lands, the PLANNED values from the spec render, so the
// page is meaningful from the second the resource is created (reference/17-custom-result-views.md).
@Component({
  selector: 'ns-overview-panel',
  imports: [CommonLibComponentsModule, StatusBadgeComponent],
  styles: [`
    .mini-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: .6rem; padding: .5rem 0; }
    .mini-card { border: 1px solid #e7ebf0; border-radius: 8px; padding: .6rem .8rem; min-width: 0; }
    .mini-card h6 { margin-bottom: .2rem; }
    .mini-value { font-weight: 600; word-break: break-all; }
  `],
  template: `
    @if (item(); as it) {
      <div class="p-1">
        <div class="mini-grid">
          <div class="mini-card">
            <h6 class="text-muted">VPC</h6>
            <div class="mini-value">{{ it.result?.vpcId || (it.spec?.vpcCidr + ' (planned)') }}</div>
          </div>
          <div class="mini-card">
            <h6 class="text-muted">Subnets</h6>
            <div class="mini-value">{{ subnetSummary() }}</div>
          </div>
          <div class="mini-card">
            <h6 class="text-muted">Security Group</h6>
            <div class="mini-value">{{ it.result?.securityGroupId || 'default egress-only (planned)' }}</div>
          </div>
        </div>

        <h6 class="text-muted mt-1">Modules</h6>
        <div class="list-group list-group-flush">
          @for (m of modules(); track m.key) {
            <div class="list-group-item d-flex align-items-center px-0 py-50">
              <span class="mr-auto">{{ m.label }}</span>
              <app-status-badge [status]="m.status"></app-status-badge>
            </div>
          }
        </div>

        @if (it.result?.actions?.length) {
          <h6 class="text-muted mt-1">Recent runs</h6>
          <div class="list-group list-group-flush">
            @for (a of recentActions(); track a.runId ?? a.requestedAt) {
              <div class="list-group-item d-flex align-items-center px-0 py-50">
                <span class="text-capitalize font-weight-bold mr-75">{{ a.action }}</span>
                <span class="text-muted text-truncate mr-auto">{{ a.summary || '—' }}</span>
                @if (a.requestedBy) { <small class="text-muted mr-1">{{ a.requestedBy }}</small> }
                <app-status-badge [status]="a.status"></app-status-badge>
              </div>
            }
          </div>
        }
      </div>
    }
  `,
})
export class OverviewPanelComponent {
  readonly item = input.required<NetworkStack>();

  // computed(), not getters: recompute only when the input changes (OnPush-safe, no per-CD churn).
  protected readonly subnetSummary = computed(() => {
    const it = this.item();
    const live = it.result?.subnetIds;
    if (live?.length) return `${live.length} created`;
    const planned = it.spec?.subnets ?? [];
    return planned.length ? `${planned.length} planned` : '—';
  });

  /** Module rows — synthesized as NotStarted from the fixed module set until the skill's first post. */
  protected readonly modules = computed(() => {
    const posted = this.item().result?.modules;
    if (posted?.length) return posted;
    return [
      { key: 'vpc', label: 'VPC', status: 'NotStarted' },
      { key: 'subnets', label: 'Subnets', status: 'NotStarted' },
      { key: 'security', label: 'Security Group', status: 'NotStarted' },
    ];
  });

  protected readonly recentActions = computed(() =>
    [...(this.item().result?.actions ?? [])].reverse().slice(0, 5));
}
