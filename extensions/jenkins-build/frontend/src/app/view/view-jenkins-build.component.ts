import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom, interval, Subscription } from 'rxjs';
import { CommonLibComponentsModule, DeleteConfirmationModalService, FlatStatusFilter } from '@duplocloud-internal/ng-common-lib';
import { JenkinsBuild, JenkinsBuildService } from '../jenkins-build.service';
import { StatusBadgeComponent } from '../shared/status-badge.component';
import { OverviewPanelComponent } from '../shared/overview-panel.component';
import { LogsPanelComponent } from '../shared/logs-panel.component';
import { ArtifactsPanelComponent } from '../shared/artifacts-panel.component';

// Detail view — Option B custom tabbed results (reference/17-custom-result-views.md):
//  • the OUTER switcher (app-flat-status-filter in #headerFilter) holds the PANELS: Result | Spec;
//  • INSIDE the Result panel an ngbNav tab strip renders Overview | Logs | Artifacts — one standalone
//    panel component per tab, lazily instantiated by ngbNavContent on first show;
//  • WORKER mode: no provisioning ticket exists, so there is NO "Track Provisioning Status" button, no
//    "View Provisioning Ticket" action, and no track()/ticketName() (02-authoring-guide.md's Worker-mode
//    FE rule) — the footer only shows subStatus;
//  • a 3s poll refreshes the resource while non-terminal and STOPS at terminal status.
//
// ngbNav's [(activeId)] stays a PLAIN FIELD, not a signal: ngbNav writes it from a template event, so a
// plain field repaints fine under OnPush (samples/parent-child's view-parent precedent).
@Component({
  selector: 'jb-view',
  imports: [CommonLibComponentsModule, StatusBadgeComponent, OverviewPanelComponent, LogsPanelComponent, ArtifactsPanelComponent],
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
          <h4 class="card-title"><app-status-badge [status]="it.result?.buildStatus || it.status"></app-status-badge></h4>
        </sidecard>
        <sidecard featherIcon="briefcase">
          <h6 class="card-subtitle text-muted">Job</h6>
          <h4 class="card-title">{{ it.spec?.jobName || '—' }}</h4>
        </sidecard>
        <sidecard featherIcon="hash">
          <h6 class="card-subtitle text-muted">Build #</h6>
          <h4 class="card-title">{{ it.result?.buildNumber ?? '—' }}</h4>
        </sidecard>

        <section class="card px-2 py-1">
          @switch (activePanel()) {
            @case ('result') {
              <div class="tabs">
                <ul ngbNav #resultNav="ngbNav" [(activeId)]="activeTab" class="nav-tabs px-1 pt-1">
                  <li [ngbNavItem]="'overview'">
                    <a ngbNavLink>Overview</a>
                    <ng-template ngbNavContent><jb-overview-panel [item]="it" /></ng-template>
                  </li>
                  <li [ngbNavItem]="'logs'">
                    <a ngbNavLink>Logs</a>
                    <ng-template ngbNavContent><jb-logs-panel [item]="it" /></ng-template>
                  </li>
                  @if (hasArtifacts()) {
                    <li [ngbNavItem]="'artifacts'">
                      <a ngbNavLink>Artifacts</a>
                      <ng-template ngbNavContent><jb-artifacts-panel [item]="it" /></ng-template>
                    </li>
                  }
                </ul>
                <div [ngbNavOutlet]="resultNav"></div>
              </div>
            }
            @case ('spec') {
              <div class="p-1">
                <div class="row">
                  <div class="col-md-6"><strong>Job:</strong> {{ it.spec?.jobName || '—' }}</div>
                  <div class="col-md-6"><strong>Credentials:</strong> {{ it.spec?.scopeIds?.[0] || '—' }}</div>
                </div>
                @if (parameterEntries().length) {
                  <div class="mt-50">
                    <strong>Parameters:</strong>
                    @for (entry of parameterEntries(); track entry[0]) {
                      <div class="text-monospace">{{ entry[0] }} = {{ entry[1] }}</div>
                    }
                  </div>
                }
              </div>
            }
          }

          @if (actionError(); as err) {
            <div class="alert alert-danger p-75 mx-1 mb-50">{{ err }}</div>
          }

          <div class="d-flex justify-content-end align-items-center px-1 pb-1 pt-50">
            @if (it.subStatus) {
              <span class="font-small-3 text-muted mr-75 text-truncate" style="max-width:60%"
                    [title]="it.subStatus">{{ it.subStatus }}</span>
            }
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
export class ViewJenkinsBuildComponent implements OnInit {
  // A worker's terminal states are the same resource-status terminals as everywhere else — the Jenkins
  // build's OWN outcome (SUCCESS/FAILURE/...) lives in result.buildStatus and does not gate polling here,
  // since even a Jenkins-side FAILURE still lands the resource in Complete (see backend JenkinsBuildWorker).
  private static readonly TERMINAL = ['Complete', 'Failed', 'DeProvisioned', 'Blocked', 'WaitingForApproval'];

  private readonly svc = inject(JenkinsBuildService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly deleteModal = inject(DeleteConfirmationModalService);

  protected readonly item = signal<JenkinsBuild | undefined>(undefined);
  protected readonly activePanel = signal<'result' | 'spec'>('result');
  protected readonly actionError = signal<string | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly panelFilters = [
    new FlatStatusFilter({ name: 'result', label: 'Result' }),
    new FlatStatusFilter({ name: 'spec', label: 'Spec' }),
  ];

  // ngbNav writes this from a template event — keep it a plain field (see the header comment).
  protected activeTab = 'overview';

  protected readonly parameterEntries = computed(() => Object.entries(this.item()?.spec?.parameters ?? {}));

  // Jenkins jobs that publish nothing (most build/deploy jobs) leave result.artifacts empty — an
  // Artifacts tab with nothing to show is worse than no tab, so it only renders once the build actually
  // reports at least one artifact.
  protected readonly hasArtifacts = computed(() => (this.item()?.result?.artifacts?.length ?? 0) > 0);

  private poll?: Subscription;

  ngOnInit(): void {
    this.refresh();
    this.destroyRef.onDestroy(() => this.poll?.unsubscribe());
  }

  private refresh(): void {
    const id = this.route.snapshot.params['id'];
    this.svc.get(id).subscribe({
      next: it => {
        this.item.set(it);
        this.loadError.set(null);
        const inFlight = !ViewJenkinsBuildComponent.TERMINAL.includes(it?.status ?? '');
        if (inFlight && !this.poll) {
          this.poll = interval(3000).subscribe(() => this.refresh());
        }
        if (!inFlight && this.poll) {
          this.poll.unsubscribe();
          this.poll = undefined;
        }
      },
      error: () => {
        this.loadError.set('Failed to load — retrying…');
        if (!this.poll) {
          this.poll = interval(3000).subscribe(() => this.refresh());
        }
      },
    });
  }

  /** Same two-step lifecycle as the list's Delete (reference/11); back to the list on success. */
  protected remove(): void {
    const it = this.item();
    if (!it) {
      return;
    }
    const buildStatus = (it.result?.buildStatus || '').toUpperCase();
    const running = buildStatus === 'QUEUED' || buildStatus === 'BUILDING';
    const st = (it.status || '').toLowerCase();
    const hardDelete = !running && ['new', 'failed', 'deprovisioned'].includes(st) && !it.result?.buildNumber;
    const deprovision = !hardDelete && (running || ['complete', 'failed', 'deprovisionfailed', 'waitingforapproval'].includes(st));
    if (!hardDelete && !deprovision) {
      this.actionError.set(`"${it.name}" is ${it.status} — wait for the current run to finish before deleting it.`);
      return;
    }
    const action = () => firstValueFrom(hardDelete ? this.svc.remove(it.id) : this.svc.deprovision(it.id))
      .then(() => this.router.navigate(['../..'], { relativeTo: this.route }))
      .catch(e => { this.actionError.set(e?.error?.message || 'Delete failed.'); throw e; });
    try {
      this.deleteModal.openGeneric('Jenkins Build', it.name, action, undefined, hardDelete ? 'Delete' : 'Deprovision');
    } catch {
      if (window.confirm(`Delete Jenkins build "${it.name}"?`)) { action().catch(() => undefined); }
    }
  }
}
