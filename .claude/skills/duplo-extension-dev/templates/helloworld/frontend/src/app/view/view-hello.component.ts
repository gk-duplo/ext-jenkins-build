import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonLibComponentsModule, FlatStatusFilter } from '@duplocloud-internal/ng-common-lib';
import { HelloService, HelloWorld } from '../hello.service';
import { StatusBadgeComponent } from '../shared/status-badge.component';

// Detail view mirroring the platform resource pattern (network-baselines / TFDeployment):
//  • view-header-card with avatar-badge title + an Actions dropdown + a Spec/Result toggle (app-flat-status-filter);
//  • @switch on activePanel → Spec cards | hand-written Result markup;
//  • a footer with the agent's subStatus + a "Track Provisioning Status" button.
//
// Hand-written result markup is the default. For the OPTIONAL declarative renderer (simple/static results
// only) see reference/09-result-templates; for rich tabbed results (Overview | Logs | …) see
// reference/17-custom-result-views.
//
// CommonLibComponentsModule re-exports CommonModule (the date pipe) and NgbModule (ngbDropdownItem) along
// with the view shell components, so it is the only platform import this template needs.
@Component({
  selector: 'hw-view',
  imports: [CommonLibComponentsModule, StatusBadgeComponent],
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
        <sidecard featherIcon="calendar">
          <h6 class="card-subtitle text-muted">Created At</h6>
          <h4 class="card-title">{{ it.createdAt | date:'medium' }}</h4>
        </sidecard>

        <section class="card px-2 py-1">
          @switch (activePanel()) {
            @case ('spec') {
              <div class="p-1">
                <div class="row">
                  <div class="col-md-6"><strong>First Name:</strong> {{ it.spec?.firstName || '—' }}</div>
                  <div class="col-md-6"><strong>Last Name:</strong> {{ it.spec?.lastName || '—' }}</div>
                </div>
              </div>
            }
            @case ('result') {
              <div class="p-1">
                <div class="row">
                  <div class="col-md-6"><strong>Full Name:</strong> {{ it.result?.fullName || '—' }}</div>
                  <div class="col-md-6"><strong>Status:</strong> <app-status-badge [status]="it.status"></app-status-badge></div>
                </div>
              </div>
            }
          }

          <!-- Status footer: subStatus + Track button (network-baselines pattern) -->
          <div class="d-flex justify-content-end align-items-center px-1 pb-1 pt-50">
            @if (it.subStatus) {
              <span class="font-small-3 text-muted mr-75 text-truncate" style="max-width:60%"
                    [title]="it.subStatus">{{ it.subStatus }}</span>
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
export class ViewHelloComponent implements OnInit {
  private readonly svc = inject(HelloService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly item = signal<HelloWorld | undefined>(undefined);
  protected readonly activePanel = signal<'spec' | 'result'>('spec');
  protected readonly tracking = signal(false);
  protected readonly panelFilters = [
    new FlatStatusFilter({ name: 'spec', label: 'Spec' }),
    new FlatStatusFilter({ name: 'result', label: 'Result' }),
  ];

  ngOnInit(): void {
    const id = this.route.snapshot.params['id'];
    this.svc.get(id).subscribe(i => {
      this.item.set(i);
      this.activePanel.set(i?.result?.fullName ? 'result' : 'spec');
    });
  }

  // 'view/:id' is two URL segments, so climb both before addressing the sibling 'edit/:id'.
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
        this.router.navigate(['/ai/service-desk', this.svc.workspaceId(), 'tickets', 'chat', name]);
      },
      error: () => this.tracking.set(false),
    });
  }
}
