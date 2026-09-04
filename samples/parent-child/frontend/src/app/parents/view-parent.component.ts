import { Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  CommonLibComponentsModule,
  FilterTableUtils,
  SearchableDatatableComponent,
  SearchableDatatableModule,
} from '@duplocloud-internal/ng-common-lib';
import { ParentChildService, HelloChild, HelloParent } from '../parentchild.service';
import { ResultTemplateModule } from '../result-template/result-template.module';
import { StatusBadgeComponent } from '../shared/status-badge.component';

const PARENT_TEMPLATE: any = {
  resourceType: 'HelloParent', subType: 'hello-parent', label: 'Parent', idField: 'id',
  groups: [{ name: 'Result', fields: [
    { type: 'single', key: 'slug', label: 'Slug', value: 'result.slug', hideWhenEmpty: true },
    { type: 'single', key: 'title', label: 'Title', value: 'spec.title', mono: false },
  ] }],
};

// Parent detail view (Pattern B from reference/08): the parent owns a Children tab + a Result tab.
// Header mirrors the platform resource pattern (avatar-badge title + Actions dropdown). The children are
// listed in a <searchable-datatable> with row-links into the nested child route; Result uses the
// declarative <app-resource-template-view>. Footer shows subStatus + a Track Provisioning Status button.
//
// CommonLibComponentsModule re-exports CommonModule and NgbModule (ngbNav, ngbDropdownItem) along with the
// view shell components.
@Component({
  selector: 'pc-view-parent',
  imports: [CommonLibComponentsModule, SearchableDatatableModule, ResultTemplateModule, StatusBadgeComponent],
  template: `
    @if (parent(); as p) {
      <view-with-sidecards>
        <view-header-card [compactActions]="true">
          <ng-template #title>
            <h3 class="text-uppercase mr-auto">
              <span class="badge avatar-badge">{{ p.name?.[0] }}</span>
              <span class="name-badge">{{ p.name }}</span>
            </h3>
          </ng-template>
          <ng-template #actions>
            <a ngbDropdownItem (click)="addChild()"><i data-feather="plus"></i> Add Child</a>
            <a ngbDropdownItem (click)="track()"><i data-feather="terminal"></i> View Provisioning Ticket</a>
          </ng-template>
        </view-header-card>

        <sidecard featherIcon="activity">
          <h6 class="card-subtitle text-muted">Status</h6>
          <h4 class="card-title"><app-status-badge [status]="p.status"></app-status-badge></h4>
        </sidecard>
        <sidecard featherIcon="tag">
          <h6 class="card-subtitle text-muted">Title</h6>
          <h4 class="card-title">{{ p.spec?.title || '—' }}</h4>
        </sidecard>

        <section class="card px-2 py-1">
          <ul ngbNav #nav="ngbNav" class="nav nav-tabs flat-tabs" [(activeId)]="activeTab">
            <li ngbNavItem="children">
              <a ngbNavLink>Children</a>
              <ng-template ngbNavContent>
                <div class="card datatable-card">
                  <searchable-datatable [showAdd]="true" addLabel="Add Child" (add)="addChild()"
                                        [rows]="children()" (filter)="childFilterUpdate()" columnMode="force">
                    <ngx-datatable-column name="Name" [flexGrow]="160">
                      <ng-template ngx-datatable-cell-template let-row="row">
                        <a (click)="openChild(row)" class="text-primary font-weight-medium cursor-pointer">{{ row.name }}</a>
                      </ng-template>
                    </ngx-datatable-column>
                    <ngx-datatable-column name="Note" [flexGrow]="200">
                      <ng-template ngx-datatable-cell-template let-row="row">{{ row.spec?.note || '—' }}</ng-template>
                    </ngx-datatable-column>
                    <ngx-datatable-column name="Status" [flexGrow]="110" [maxWidth]="150">
                      <ng-template ngx-datatable-cell-template let-row="row">
                        <app-status-badge [status]="row.status"></app-status-badge>
                      </ng-template>
                    </ngx-datatable-column>
                  </searchable-datatable>
                </div>
              </ng-template>
            </li>
            <li ngbNavItem="result">
              <a ngbNavLink>Result</a>
              <ng-template ngbNavContent>
                <app-resource-template-view [template]="viewTemplate() || parentTemplate" [data]="p">
                </app-resource-template-view>
              </ng-template>
            </li>
          </ul>
          <div [ngbNavOutlet]="nav" class="mt-1"></div>

          <div class="d-flex justify-content-end align-items-center px-1 pb-1 pt-50">
            @if (p.subStatus) {
              <span class="font-small-3 text-muted mr-75 text-truncate" style="max-width:60%"
                    [title]="p.subStatus">{{ p.subStatus }}</span>
            }
            <button class="btn btn-primary btn-sm" (click)="track()" [disabled]="tracking()">
              <i data-feather="zap" class="mr-50"></i> Track Provisioning Status
            </button>
          </div>
        </section>
      </view-with-sidecards>
    } @else {
      <div class="text-muted p-2">Loading…</div>
    }
  `,
})
export class ViewParentComponent implements OnInit {
  private readonly svc = inject(ParentChildService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  // The children <searchable-datatable> owns the search box + term; we read its `searchTerm` when filtering.
  private readonly table = viewChild(SearchableDatatableComponent);

  protected readonly parent = signal<HelloParent | undefined>(undefined);
  protected readonly viewTemplate = signal<any>(null);
  protected readonly tracking = signal(false);
  /** ngbNav writes this from a template event, so a plain field repaints fine under OnPush. */
  protected activeTab = 'children';
  protected readonly parentTemplate = PARENT_TEMPLATE;

  /** Full unfiltered set from the last fetch. */
  private readonly allChildren = signal<HelloChild[]>([]);
  private readonly childFilterTerm = signal('');
  // Plain string fields or dot-paths only — searchByFields uses lodash `get`; no method calls.
  private readonly childSearchFields = ['name', 'status', 'spec.note'];

  protected readonly children = computed(() => {
    const term = this.childFilterTerm();
    const all = this.allChildren();
    return term ? all.filter(c => FilterTableUtils.searchByFields(c, this.childSearchFields, term)) : all;
  });

  private parentId = '';

  ngOnInit(): void {
    this.parentId = this.route.snapshot.params['parentId'];
    this.svc.getParent(this.parentId).subscribe(p => this.parent.set(p));
    // This view is opened per-parent via the `parentId` route param — not a workspace-scoped list — so
    // children load once here; no getTenantRefreshTimer subscription is needed.
    this.svc.listChildren(this.parentId).subscribe(c => this.allChildren.set(c ?? []));
    this.svc.parentViewTemplate().subscribe(t => this.viewTemplate.set(t));
  }

  // The children table's search box emits (filter) on each keystroke; `children` recomputes from the term.
  protected childFilterUpdate(): void {
    this.childFilterTerm.set(this.table()?.searchTerm?.toLowerCase()?.trim() ?? '');
  }

  protected addChild(): void {
    this.router.navigate(['children', 'add'], { relativeTo: this.route });
  }

  protected openChild(c: HelloChild): void {
    this.router.navigate(['children', c.id], { relativeTo: this.route });
  }

  protected track(): void {
    const p = this.parent();
    if (!p) {
      return;
    }
    this.tracking.set(true);
    this.svc.parentTicketName(p.id).subscribe({
      next: name => {
        this.tracking.set(false);
        if (!name) {
          return;
        }
        this.router.navigate(['/ai/service-desk', this.svc.workspaceId(), 'tickets', 'chat', name]);
      },
      error: () => this.tracking.set(false),
    });
  }
}
