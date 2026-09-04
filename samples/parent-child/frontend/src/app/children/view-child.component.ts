import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonLibComponentsModule, FlatStatusFilter } from '@duplocloud-internal/ng-common-lib';
import { ParentChildService, HelloChild } from '../parentchild.service';
import { ResultTemplateModule } from '../result-template/result-template.module';
import { StatusBadgeComponent } from '../shared/status-badge.component';

const CHILD_TEMPLATE: any = {
  resourceType: 'HelloChild', subType: 'hello-child', label: 'Child', idField: 'id',
  groups: [{ name: 'Result', fields: [
    { type: 'single', key: 'message', label: 'Message', value: 'result.message', hideWhenEmpty: true },
    { type: 'single', key: 'note', label: 'Note', value: 'spec.note', mono: false },
  ] }],
};

// Child detail view — mirrors the platform resource pattern: header (avatar-badge) + Spec/Result toggle
// (app-flat-status-filter) + template-driven Result + footer (subStatus + Track button).
@Component({
  selector: 'pc-view-child',
  imports: [CommonLibComponentsModule, ResultTemplateModule, StatusBadgeComponent],
  template: `
    @if (child(); as c) {
      <view-with-sidecards>
        <view-header-card [compactActions]="true">
          <ng-template #title>
            <h3 class="text-uppercase mr-auto">
              <span class="badge avatar-badge">{{ c.name?.[0] }}</span>
              <span class="name-badge">{{ c.name }}</span>
            </h3>
          </ng-template>
          <ng-template #actions>
            <a ngbDropdownItem (click)="back()"><i data-feather="arrow-left"></i> Back to Parent</a>
            <a ngbDropdownItem (click)="track()"><i data-feather="terminal"></i> View Provisioning Ticket</a>
          </ng-template>
          <ng-template #headerFilter>
            <app-flat-status-filter [filters]="panelFilters" [activeStatus]="activePanel()" [showCount]="false"
                                    (changed)="activePanel.set($event)"></app-flat-status-filter>
          </ng-template>
        </view-header-card>

        <sidecard featherIcon="activity">
          <h6 class="card-subtitle text-muted">Status</h6>
          <h4 class="card-title"><app-status-badge [status]="c.status"></app-status-badge></h4>
        </sidecard>

        <section class="card px-2 py-1">
          @switch (activePanel()) {
            @case ('spec') {
              <div class="p-1"><strong>Note:</strong> {{ c.spec?.note || '—' }}</div>
            }
            @case ('result') {
              <app-resource-template-view [template]="viewTemplate() || childTemplate" [data]="c">
              </app-resource-template-view>
            }
          }
          <div class="d-flex justify-content-end align-items-center px-1 pb-1 pt-50">
            @if (c.subStatus) {
              <span class="font-small-3 text-muted mr-75 text-truncate" style="max-width:60%"
                    [title]="c.subStatus">{{ c.subStatus }}</span>
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
export class ViewChildComponent implements OnInit {
  private readonly svc = inject(ParentChildService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly child = signal<HelloChild | undefined>(undefined);
  protected readonly viewTemplate = signal<any>(null);
  protected readonly activePanel = signal<'spec' | 'result'>('spec');
  protected readonly tracking = signal(false);
  protected readonly panelFilters = [
    new FlatStatusFilter({ name: 'spec', label: 'Spec' }),
    new FlatStatusFilter({ name: 'result', label: 'Result' }),
  ];
  protected readonly childTemplate = CHILD_TEMPLATE;

  private parentId = '';

  ngOnInit(): void {
    this.parentId = this.route.snapshot.params['parentId'];
    const childId = this.route.snapshot.params['childId'];
    this.svc.getChild(this.parentId, childId).subscribe(c => {
      this.child.set(c);
      this.activePanel.set(c?.result?.message ? 'result' : 'spec');
    });
    this.svc.childViewTemplate(this.parentId).subscribe(t => this.viewTemplate.set(t));
  }

  protected track(): void {
    const c = this.child();
    if (!c) {
      return;
    }
    this.tracking.set(true);
    this.svc.childTicketName(c.id).subscribe({
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

  protected back(): void {
    this.router.navigate(['../..'], { relativeTo: this.route });
  }
}
