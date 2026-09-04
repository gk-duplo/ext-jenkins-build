import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom, interval, Subscription } from 'rxjs';
import { CommonLibComponentsModule, DeleteConfirmationModalService, FlatStatusFilter } from '@duplocloud-internal/ng-common-lib';
import { NetworkStack, NetworkStackService } from '../network-stack.service';
import { StatusBadgeComponent } from '../shared/status-badge.component';
import { OverviewPanelComponent } from '../shared/overview-panel.component';
import { NetworkPanelComponent } from '../shared/network-panel.component';
import { LogsPanelComponent } from '../shared/logs-panel.component';
import { AskAiPanelComponent } from '../shared/ask-ai-panel.component';

// Detail view — the dev-kit's CUSTOM TABBED RESULTS reference (reference/17-custom-result-views.md):
//  • the OUTER switcher (app-flat-status-filter in #headerFilter) still holds the PANELS: Result | Spec;
//  • INSIDE the Result panel an ngbNav tab strip renders Overview | Network | Logs | Ask AI — one
//    standalone panel component per tab, lazily instantiated by ngbNavContent on first show;
//  • Ask AI is the LAST results tab (reference/16), never an entry in the outer switcher;
//  • footer: live subStatus + Track Provisioning + the on-demand Plan/Apply action buttons
//    (Apply stays disabled until a plan has succeeded — mirrored from result.applyAllowed);
//  • a 3s poll refreshes the resource while a run is in flight and STOPS at terminal status.
//
// ngbNav's [(activeId)] stays a PLAIN FIELD, not a signal: ngbNav writes it from a template event, so
// a plain field repaints fine under OnPush — don't fight it (see samples/parent-child's view-parent).
@Component({
  selector: 'ns-view',
  imports: [CommonLibComponentsModule, StatusBadgeComponent, OverviewPanelComponent,
            NetworkPanelComponent, LogsPanelComponent, AskAiPanelComponent],
  template: `
    @if (item(); as it) {
      <view-with-sidecards>
        <view-header-card [compactActions]="true">
          <ng-template #title>
            <h3 class="text-uppercase mr-auto">
              <span class="badge avatar-badge">{{ it.name?.[0] }}</span>
              <span class="name-badge">{{ it.name }}</span>
            </h3>
          </ng-template>

          <ng-template #actions>
            <a ngbDropdownItem (click)="edit()"><i data-feather="edit"></i> Edit</a>
            <a ngbDropdownItem (click)="track()"><i data-feather="terminal"></i> View Provisioning Ticket</a>
            <a ngbDropdownItem class="text-danger" (click)="remove()"><i data-feather="trash-2"></i> Delete</a>
          </ng-template>

          <ng-template #headerFilter>
            <app-flat-status-filter
              [filters]="panelFilters"
              [activeStatus]="activePanel()"
              [showCount]="false"
              (changed)="activePanel.set($event)">
            </app-flat-status-filter>
          </ng-template>
        </view-header-card>

        <sidecard featherIcon="activity">
          <h6 class="card-subtitle text-muted">Status</h6>
          <h4 class="card-title"><app-status-badge [status]="it.status"></app-status-badge></h4>
        </sidecard>
        <sidecard featherIcon="globe">
          <h6 class="card-subtitle text-muted">Region</h6>
          <h4 class="card-title">{{ it.spec?.region || '—' }}</h4>
        </sidecard>
        <sidecard featherIcon="git-branch">
          <h6 class="card-subtitle text-muted">Subnets</h6>
          <h4 class="card-title">{{ it.result?.subnetIds?.length || it.spec?.subnets?.length || 0 }}</h4>
        </sidecard>

        <section class="card px-2 py-1">
          @switch (activePanel()) {
            @case ('result') {
              <!-- The Results tab strip (reference/17). Ask AI is deliberately LAST (reference/16). -->
              <div class="tabs">
                <ul ngbNav #resultNav="ngbNav" [(activeId)]="activeTab" class="nav-tabs">
                  <li [ngbNavItem]="'overview'">
                    <a ngbNavLink>Overview</a>
                    <ng-template ngbNavContent>
                      <ns-overview-panel [item]="it" />
                    </ng-template>
                  </li>
                  <li [ngbNavItem]="'network'">
                    <a ngbNavLink>Network</a>
                    <ng-template ngbNavContent>
                      <ns-network-panel [item]="it" />
                    </ng-template>
                  </li>
                  <li [ngbNavItem]="'logs'">
                    <a ngbNavLink>Logs</a>
                    <ng-template ngbNavContent>
                      <ns-logs-panel [item]="it" />
                    </ng-template>
                  </li>
                  <li [ngbNavItem]="'ask-ai'">
                    <a ngbNavLink>Ask AI</a>
                    <ng-template ngbNavContent>
                      <ns-ask-ai-panel [resource]="it" />
                    </ng-template>
                  </li>
                </ul>
                <div [ngbNavOutlet]="resultNav"></div>
              </div>
            }
            @case ('spec') {
              <div class="p-1">
                <div class="row">
                  <div class="col-md-4"><strong>Region:</strong> {{ it.spec?.region || '—' }}</div>
                  <div class="col-md-4"><strong>VPC CIDR:</strong> {{ it.spec?.vpcCidr || '—' }}</div>
                  <div class="col-md-4"><strong>Scope:</strong> {{ it.spec?.scopeIds?.[0] || '—' }}</div>
                </div>
                <div class="mt-50">
                  <strong>Subnets:</strong>
                  @for (s of it.spec?.subnets ?? []; track $index) {
                    <div class="text-monospace">{{ s.name }} — {{ s.cidr }}{{ s.az ? ' (' + s.az + ')' : '' }}</div>
                  }
                </div>
              </div>
            }
          }

          @if (actionError(); as err) {
            <div class="alert alert-danger p-75 mx-1 mb-50">{{ err }}</div>
          }

          <!-- Footer: live subStatus + Track Provisioning + the on-demand Plan/Apply actions -->
          <div class="d-flex justify-content-end align-items-center px-1 pb-1 pt-50">
            @if (it.subStatus) {
              <span class="font-small-3 text-muted mr-75 text-truncate" style="max-width:45%"
                    [title]="it.subStatus">{{ it.subStatus }}</span>
            }
            <!-- The last plan is current (applyAllowed) and reported NO diff — applying would be a no-op. -->
            @if (!runBusy() && it.result?.applyAllowed && it.result?.lastPlanHasDiff === false) {
              <span class="badge badge-light-secondary mr-75">Plan found no changes</span>
            }
            <button class="btn btn-outline-primary btn-sm mr-75" (click)="runAction('plan')"
                    [disabled]="runBusy()">
              <i data-feather="search" class="mr-50"></i> Plan
            </button>
            <button class="btn btn-outline-primary btn-sm mr-75" (click)="runAction('apply')"
                    [disabled]="runBusy() || !it.result?.applyAllowed"
                    title="Apply is enabled once a plan has succeeded">
              <i data-feather="play" class="mr-50"></i> Apply
            </button>
            <button class="btn btn-primary btn-sm" (click)="track()" [disabled]="tracking()">
              <i data-feather="zap" class="mr-50"></i> Track Provisioning Status
            </button>
          </div>
        </section>
      </view-with-sidecards>
    } @else {
      <div class="p-2" [class.text-muted]="!loadError()" [class.text-danger]="!!loadError()">
        {{ loadError() || 'Loading…' }}
      </div>
    }
  `,
})
export class ViewNetworkStackComponent implements OnInit {
  private static readonly TERMINAL = ['Complete', 'Failed', 'DeProvisioned', 'Blocked', 'WaitingForApproval'];

  private readonly svc = inject(NetworkStackService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly deleteModal = inject(DeleteConfirmationModalService);

  protected readonly item = signal<NetworkStack | undefined>(undefined);
  protected readonly activePanel = signal<'result' | 'spec'>('result');
  protected readonly tracking = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly panelFilters = [
    new FlatStatusFilter({ name: 'result', label: 'Result' }),
    new FlatStatusFilter({ name: 'spec', label: 'Spec' }),
  ];

  // ngbNav writes this from a template event — keep it a plain field (see the header comment).
  protected activeTab = 'overview';

  /** A run is in flight — disable the action buttons and keep polling. */
  protected readonly runBusy = computed(() => {
    const st = this.item()?.status ?? '';
    return !ViewNetworkStackComponent.TERMINAL.includes(st);
  });

  private poll?: Subscription;

  ngOnInit(): void {
    this.refresh();
    this.destroyRef.onDestroy(() => this.poll?.unsubscribe());
  }

  /**
   * GET + 3s poll while a run is in flight; the poll STOPS at terminal status (reference/17).
   * After a Plan/Apply trigger there is a WINDOW where status is still terminal — the backend only stamps
   * spec.lastRequestedAction (202); the skill posts Processing when the agent turn starts, seconds to
   * minutes later. `actionKickUntil` keeps the poll alive through that window so the flip is observed.
   */
  private actionKickUntil = 0;

  private refresh(): void {
    const id = this.route.snapshot.params['id'];
    this.svc.get(id).subscribe({
      next: it => {
        this.item.set(it);
        this.loadError.set(null);
        const inFlight = !ViewNetworkStackComponent.TERMINAL.includes(it?.status ?? '');
        if (inFlight) {
          this.actionKickUntil = 0;   // the flip landed — normal poll rules from here
        }
        const keepAlive = inFlight || Date.now() < this.actionKickUntil;
        if (keepAlive && !this.poll) {
          this.poll = interval(3000).subscribe(() => this.refresh());
        }
        if (!keepAlive && this.poll) {
          this.poll.unsubscribe();
          this.poll = undefined;
        }
      },
      error: () => {
        // On a FIRST-load failure no poll exists yet, so nothing would ever retry — start one and say
        // so instead of sticking on "Loading…" forever. Later failures ride the existing poll.
        this.loadError.set('Failed to load — retrying…');
        if (!this.poll) {
          this.poll = interval(3000).subscribe(() => this.refresh());
        }
      },
    });
  }

  protected runAction(action: 'plan' | 'apply'): void {
    const it = this.item();
    if (!it) {
      return;
    }
    this.actionError.set(null);
    this.svc.triggerAction(it.id, action).subscribe({
      next: () => {
        // Keep polling for up to 3 min even while status is still terminal — the Processing flip arrives
        // only when the agent picks the request up (see refresh()).
        this.actionKickUntil = Date.now() + 180_000;
        this.refresh();
      },
      error: e => this.actionError.set(e?.error?.message || e?.error || `Could not start the ${action}.`),
    });
  }

  /** Same two-step lifecycle as the list's Delete (reference/11); back to the list on success. */
  protected remove(): void {
    const it = this.item();
    if (!it) {
      return;
    }
    const st = (it.status || '').toLowerCase();
    const hardDelete = ['new', 'failed', 'deprovisioned'].includes(st) && !it.result?.vpcId;
    const deprovision = !hardDelete && ['complete', 'failed', 'deprovisionfailed', 'waitingforapproval'].includes(st);
    if (!hardDelete && !deprovision) {
      this.actionError.set(`"${it.name}" is ${it.status} — wait for the current run to finish before deleting it.`);
      return;
    }
    const action = () => firstValueFrom(hardDelete ? this.svc.remove(it.id) : this.svc.deprovision(it.id))
      .then(() => this.router.navigate(['../..'], { relativeTo: this.route }))
      .catch(e => { this.actionError.set(e?.error?.message || 'Delete failed.'); throw e; });
    try {
      this.deleteModal.openGeneric('Network Stack', it.name, action, undefined, hardDelete ? 'Delete' : 'Deprovision');
    } catch {
      if (window.confirm(`Delete network stack "${it.name}"?`)) { action().catch(() => undefined); }
    }
  }

  protected edit(): void {
    const it = this.item();
    if (it) {
      this.router.navigate(['../..', 'edit', it.id], { relativeTo: this.route });
    }
  }

  protected track(): void {
    const it = this.item();
    if (!it) {
      return;
    }
    this.tracking.set(true);
    this.svc.ticketName(it.id).subscribe({
      next: name => {
        this.tracking.set(false);
        if (!name) {
          return;
        }
        // Host routes can no-op from a remote — fall back to a hard navigation (reference/16 pitfalls).
        const url = `/ai/service-desk/${this.svc.workspaceId()}/tickets/chat/${name}`;
        this.router.navigateByUrl(url).then(ok => { if (!ok) window.location.assign(url); })
          .catch(() => window.location.assign(url));
      },
      error: () => this.tracking.set(false),
    });
  }
}
