import { Component, computed, input } from '@angular/core';
import { CommonLibComponentsModule } from '@duplocloud-internal/ng-common-lib';
import { JenkinsBuild } from '../jenkins-build.service';
import { StatusBadgeComponent } from './status-badge.component';

// Overview tab body: job name+url, build number+url as a clickable link, status badge, timestamps.
// NEVER a dead empty state — until the result lands, the PLANNED values from the spec render (the job
// name from spec.jobName, "queued" as the implied status) so the page is meaningful the moment the
// resource is created (reference/17-custom-result-views.md).
@Component({
  selector: 'jb-overview-panel',
  imports: [CommonLibComponentsModule, StatusBadgeComponent],
  styles: [`
    .mini-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: .6rem; padding: .5rem 0; }
    .mini-card { border: 1px solid #e7ebf0; border-radius: 8px; padding: .6rem .8rem; min-width: 0; }
    .mini-card h6 { margin-bottom: .2rem; }
    .mini-value { font-weight: 600; word-break: break-all; }
  `],
  template: `
    @if (item(); as it) {
      <div class="p-1">
        <div class="mini-grid">
          <div class="mini-card">
            <h6 class="text-muted">Job</h6>
            <div class="mini-value">
              @if (it.result?.jobUrl) {
                <a [href]="it.result?.jobUrl" target="_blank" rel="noopener">{{ it.result?.jobName || it.spec?.jobName }}</a>
              } @else {
                {{ it.spec?.jobName || '—' }}
              }
            </div>
          </div>
          <div class="mini-card">
            <h6 class="text-muted">Build</h6>
            <div class="mini-value">
              @if (it.result?.buildUrl && it.result?.buildNumber) {
                <a [href]="it.result?.buildUrl" target="_blank" rel="noopener">#{{ it.result?.buildNumber }}</a>
              } @else {
                queued (planned)
              }
            </div>
          </div>
          <div class="mini-card">
            <h6 class="text-muted">Status</h6>
            <div class="mini-value">
              <app-status-badge [status]="it.result?.buildStatus || 'QUEUED'"></app-status-badge>
            </div>
          </div>
          <div class="mini-card">
            <h6 class="text-muted">Started</h6>
            <div class="mini-value">{{ it.result?.startedAt ? (it.result?.startedAt | date:'medium') : '—' }}</div>
          </div>
          <div class="mini-card">
            <h6 class="text-muted">Finished</h6>
            <div class="mini-value">{{ it.result?.finishedAt ? (it.result?.finishedAt | date:'medium') : '—' }}</div>
          </div>
        </div>

        @if (parameterEntries().length) {
          <h6 class="text-muted mt-1">Build Parameters</h6>
          <table class="table table-sm">
            <tbody>
              @for (entry of parameterEntries(); track entry[0]) {
                <tr><td class="font-weight-bold">{{ entry[0] }}</td><td>{{ entry[1] }}</td></tr>
              }
            </tbody>
          </table>
        }
      </div>
    }
  `,
})
export class OverviewPanelComponent {
  readonly item = input.required<JenkinsBuild>();

  // computed(), not a getter/method call in the template: recomputes only when the input actually
  // changes rather than on every change-detection pass (17-custom-result-views.md's memoization rule).
  protected readonly parameterEntries = computed(() => Object.entries(this.item().spec?.parameters ?? {}));
}
