import { Component, DestroyRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  DeleteConfirmationModalService, FilterTableUtils, SearchableDatatableComponent, SearchableDatatableModule,
} from '@duplocloud-internal/ng-common-lib';
import { JenkinsBuild, JenkinsBuildService, REMOTE_UserSession } from '../jenkins-build.service';
import { StatusBadgeComponent } from '../shared/status-badge.component';

// List view built on the platform UI library's <searchable-datatable> — search, paging and the actions
// dropdown come for free. Columns: Name, Job, Build #, Status, Created.
//
// WORKER mode: no provisioning ticket exists, so there is no "Track Provisioning" row action (see
// 02-authoring-guide.md's Worker-mode FE rule) — only View and Delete.
@Component({
  selector: 'jb-list',
  imports: [SearchableDatatableModule, StatusBadgeComponent],
  template: `
    <div class="card datatable-card">
      @if (error(); as e) {
        <div class="alert alert-danger d-flex align-items-center m-1 mb-0 p-75">
          <span class="mr-auto">{{ e }}</span>
          <button type="button" class="close ml-1" aria-label="Dismiss" (click)="error.set('')">
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
      }
      <searchable-datatable
        [showAdd]="true"
        addLabel="Create Jenkins Build"
        (add)="add()"
        [rows]="rows()"
        (filter)="filterUpdate()"
        columnMode="force">

        <!-- Actions -->
        <ngx-datatable-column [width]="50" [sortable]="false" [canAutoResize]="false" cellClass="actions">
          <ng-template ngx-datatable-cell-template let-row="row">
            <div ngbDropdown container="body">
              <button class="btn btn-sm hide-arrow" ngbDropdownToggle>
                <i data-feather="more-vertical"></i>
              </button>
              <div ngbDropdownMenu>
                <a ngbDropdownItem (click)="view(row)">
                  <i data-feather="eye" class="mr-50"></i><span>View</span>
                </a>
                <a ngbDropdownItem class="text-danger" (click)="remove(row)">
                  <i data-feather="trash-2" class="mr-50"></i><span>Delete</span>
                </a>
              </div>
            </div>
          </ng-template>
        </ngx-datatable-column>

        <ngx-datatable-column name="Name" [flexGrow]="140">
          <ng-template ngx-datatable-cell-template let-row="row">
            <a (click)="view(row)" class="text-primary font-weight-medium cursor-pointer">{{ row.name }}</a>
          </ng-template>
        </ngx-datatable-column>

        <ngx-datatable-column name="Job" [flexGrow]="140">
          <ng-template ngx-datatable-cell-template let-row="row">{{ row.spec?.jobName || '—' }}</ng-template>
        </ngx-datatable-column>

        <ngx-datatable-column name="Build #" [flexGrow]="80" [maxWidth]="110">
          <ng-template ngx-datatable-cell-template let-row="row">{{ row.result?.buildNumber ?? '—' }}</ng-template>
        </ngx-datatable-column>

        <ngx-datatable-column name="Status" [flexGrow]="110" [maxWidth]="150">
          <ng-template ngx-datatable-cell-template let-row="row">
            <app-status-badge [status]="row.result?.buildStatus || row.status"></app-status-badge>
          </ng-template>
        </ngx-datatable-column>

        <ngx-datatable-column name="Created" [flexGrow]="130">
          <ng-template ngx-datatable-cell-template let-row="row">{{ row.createdAt | date:'medium' }}</ng-template>
        </ngx-datatable-column>

      </searchable-datatable>
    </div>
  `,
})
export class ListJenkinsBuildComponent implements OnInit {
  private readonly svc = inject(JenkinsBuildService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject<any>(REMOTE_UserSession as any);
  private readonly destroyRef = inject(DestroyRef);
  private readonly deleteModal = inject(DeleteConfirmationModalService);

  private readonly table = viewChild(SearchableDatatableComponent);

  private readonly allRows = signal<JenkinsBuild[]>([]);
  private readonly filterTerm = signal('');
  protected readonly error = signal('');

  private readonly searchFields = ['name', 'status', 'spec.jobName', 'result.buildStatus', 'result.buildNumber'];

  protected readonly rows = computed(() => {
    const term = this.filterTerm();
    const all = this.allRows();
    return term ? all.filter(r => FilterTableUtils.searchByFields(r, this.searchFields, term)) : all;
  });

  ngOnInit(): void {
    this.session.getTenantRefreshTimer(true)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([, tenantChanged]: [any, boolean]) => this.refresh(!!tenantChanged));
  }

  private refresh(tenantChanged: boolean): void {
    if (tenantChanged) {
      this.table()?.startLoading();
    }
    this.svc.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: rows => {
        this.allRows.set(rows ?? []);
        this.table()?.refresh();
      },
      error: () => {
        this.allRows.set([]);
        this.table()?.stopLoading();
        this.error.set('Could not load the Jenkins builds — retry on the next refresh, or reload the page.');
      },
    });
  }

  /**
   * Delete is a two-step lifecycle (reference/11): a terminal-but-triggered row is DEPROVISIONED (best-effort
   * abort of a still-running build; the row is removed by the worker at the end of teardown); a
   * never-triggered/failed row with nothing running is hard-DELETED. Anything in flight (QUEUED/BUILDING)
   * must be deprovisioned rather than force-deleted so the abort call actually runs.
   */
  protected remove(r: JenkinsBuild): void {
    const buildStatus = (r.result?.buildStatus || '').toUpperCase();
    const running = buildStatus === 'QUEUED' || buildStatus === 'BUILDING';
    const st = (r.status || '').toLowerCase();
    const hardDelete = !running && ['new', 'failed', 'deprovisioned'].includes(st) && !r.result?.buildNumber;
    const deprovision = !hardDelete && (running || ['complete', 'failed', 'deprovisionfailed', 'waitingforapproval'].includes(st));
    if (!hardDelete && !deprovision) {
      this.error.set(`"${r.name}" is ${r.status} — wait for the current run to finish before deleting it.`);
      return;
    }
    const action = () => firstValueFrom(hardDelete ? this.svc.remove(r.id) : this.svc.deprovision(r.id))
      .then(() => this.refresh(false))
      .catch(e => { this.error.set(e?.error?.message || 'Delete failed.'); throw e; });
    try {
      this.deleteModal.openGeneric('Jenkins Build', r.name, action, undefined, hardDelete ? 'Delete' : 'Deprovision');
    } catch {
      if (window.confirm(`Delete Jenkins build "${r.name}"?`)) { action().catch(() => undefined); }
    }
  }

  protected filterUpdate(): void {
    this.filterTerm.set(this.table()?.searchTerm?.toLowerCase()?.trim() ?? '');
  }

  protected add(): void {
    this.router.navigate(['add'], { relativeTo: this.route });
  }

  protected view(r: JenkinsBuild): void {
    this.router.navigate(['view', r.id], { relativeTo: this.route });
  }
}
