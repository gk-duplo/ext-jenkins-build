import { Component, OnInit, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NgSelectModule } from '@ng-select/ng-select';
import { FormGroupErrorsComponent, SharedFormsModule } from '@duplocloud-internal/ng-common-lib';
import { JenkinsBuildService, JenkinsJobParameter } from '../jenkins-build.service';

// Create form in the platform's 3-column `panel-form-accordion` layout — a HANDFUL OF FLAT FIELDS (scope,
// job, dynamic build parameters), so this follows the helloworld/worker-appstack ADD shape, not
// network-stack's wizard (see the dev-kit's own tiebreaker rule in 02-authoring-guide.md).
//
// Cascading selects: scope -> job -> parameters. Each level's options come from this extension's OWN
// controller endpoints (jobs?scopeId=, jobs/{jobName}/parameters?scopeId=), refreshed whenever the level
// above changes. Async-fed selects carry their state: [loading] + a placeholder per load/empty state.
@Component({
  selector: 'jb-add',
  imports: [SharedFormsModule, NgSelectModule],
  styles: [`
    :host { display: block; }
    .panel-form-accordion { background: #fff; padding: 1.25rem 0 1rem 1.5rem; }
    .panel-content-title { width: 265px; min-width: 265px; }
    .panel-content-title-sub-text { max-width: 220px; }
    .panel-content-form { max-width: 768px; flex: 1 1 auto; margin: 0 1rem; padding: 0 1rem; }
    .panel-content-sidenav { width: 265px; min-width: 265px; margin-left: 2rem; }
    .panel-content-sidenav .help-item { padding-bottom: 1rem; }
    .panel-content-sidenav .help-item-title { margin: 0; font-weight: 600; font-size: 0.9rem; }
    .field-hint { font-size: .85rem; }
  `],
  template: `
    <div class="card panel-form-accordion">
      <div class="d-flex justify-content-between">

        <div class="panel-content-title">
          <h4 class="font-weight-bolder">Create Jenkins Build</h4>
          <p class="panel-content-title-sub-text text-muted">
            Pick Jenkins credentials and a job, fill in any build parameters, and Create triggers the build
            in the background — the view page tracks it to completion.
          </p>
        </div>

        <div class="panel-content-form">
          <form name="AddJenkinsBuildForm" #f="ngForm" class="form form-vertical" (ngSubmit)="f.valid && submit()">
            <div class="form-container" form-group-errors #formGroupErrors showDetailsWhen="submitted">

              <form-field>
                <label class="element-label">Name *</label>
                <input type="text" class="form-control" name="name"
                       [ngModel]="name()" (ngModelChange)="name.set($event)"
                       placeholder="e.g. nightly-build" required validation-state validation-errors
                       minlength="2" maxlength="60" pattern="^[a-zA-Z0-9]([a-zA-Z0-9\\-]*[a-zA-Z0-9])?$" />
              </form-field>

              <form-field>
                <label class="element-label">Jenkins Credentials *</label>
                <ng-select name="scopeId" [ngModel]="scopeId()" (ngModelChange)="onScopeChange($event)"
                           [items]="scopeOptions()" bindLabel="name" bindValue="id"
                           [loading]="scopesLoading()"
                           [placeholder]="scopesLoading() ? 'Loading credentials…' : (scopeOptions().length ? 'Select Jenkins credentials' : 'No Jenkins credentials in this workspace')"
                           required validation-state validation-errors></ng-select>
                @if (!scopesLoading() && !scopeOptions().length) {
                  <div class="text-muted field-hint mt-25">
                    Attach Jenkins credentials to this workspace (a scope of type "other" with "jen" in its
                    name — Scopes → Add), then reopen this form.
                  </div>
                }
              </form-field>

              <form-field>
                <label class="element-label">Jenkins Job *</label>
                <ng-select name="jobName" [ngModel]="jobName()" (ngModelChange)="onJobChange($event)"
                           [items]="jobOptions()" bindLabel="name" bindValue="name"
                           [loading]="jobsLoading()" [disabled]="!scopeId()"
                           [placeholder]="!scopeId() ? 'Select a scope first' : (jobsLoading() ? 'Loading jobs…' : (jobOptions().length ? 'Select the Jenkins job' : 'No jobs found on this server'))"
                           required validation-state validation-errors></ng-select>
              </form-field>

              @if (parametersLoading()) {
                <div class="text-muted field-hint">Loading build parameters…</div>
              } @else if (parameters().length) {
                <label class="element-label d-block">Build Parameters</label>
                @for (p of parameters(); track p.name) {
                  <form-field>
                    <label class="element-label">{{ p.name }}</label>
                    <input type="text" class="form-control" [name]="'param_' + p.name"
                           [ngModel]="paramValues()[p.name] ?? ''"
                           (ngModelChange)="setParamValue(p.name, $event)"
                           [placeholder]="p.defaultValue || ''" />
                  </form-field>
                }
              }

              <div class="d-flex justify-content-end mt-1">
                <button type="button" class="btn btn-outline-secondary mr-1" (click)="cancel()">Cancel</button>
                <button type="submit" class="btn btn-primary" [disabled]="saving()">
                  {{ saving() ? 'Creating…' : 'Create' }}
                </button>
              </div>
            </div>
          </form>
        </div>

        <div class="panel-content-sidenav">
          <div class="help-item">
            <p class="help-item-title">Jenkins Credentials</p>
            <small class="text-muted">The Jenkins server whose credentials trigger and poll the build.</small>
          </div>
          <div class="help-item">
            <p class="help-item-title">Jenkins Job</p>
            <small class="text-muted">The job's build-parameter fields (if any) load automatically once selected.</small>
          </div>
        </div>

      </div>
    </div>
  `,
})
export class AddJenkinsBuildComponent implements OnInit {
  private readonly svc = inject(JenkinsBuildService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly name = signal('');
  protected readonly saving = signal(false);

  protected readonly scopeOptions = signal<{ id: string; name: string }[]>([]);
  protected readonly scopesLoading = signal(true);
  protected readonly scopeId = signal<string | null>(null);

  protected readonly jobOptions = signal<{ name: string; url: string }[]>([]);
  protected readonly jobsLoading = signal(false);
  protected readonly jobName = signal<string | null>(null);

  protected readonly parameters = signal<JenkinsJobParameter[]>([]);
  protected readonly parametersLoading = signal(false);
  protected readonly paramValues = signal<Record<string, string>>({});

  // Platform error reporter: the form-group-errors directive (already on the <form>) surfaces the real
  // API error via extractErrorMessage. viewChild() returns a signal — call it.
  private readonly formErrors = viewChild(FormGroupErrorsComponent);

  ngOnInit(): void {
    this.svc.listScopes().subscribe({
      next: s => { this.scopeOptions.set(s); this.scopesLoading.set(false); },
      error: () => this.scopesLoading.set(false),
    });
  }

  protected onScopeChange(scopeId: string | null): void {
    this.scopeId.set(scopeId);
    this.jobName.set(null);
    this.jobOptions.set([]);
    this.parameters.set([]);
    this.paramValues.set({});
    if (!scopeId) {
      return;
    }
    this.jobsLoading.set(true);
    this.svc.listJobs(scopeId).subscribe({
      next: jobs => { this.jobOptions.set(jobs); this.jobsLoading.set(false); },
      error: () => this.jobsLoading.set(false),
    });
  }

  protected onJobChange(jobName: string | null): void {
    this.jobName.set(jobName);
    this.parameters.set([]);
    this.paramValues.set({});
    const scopeId = this.scopeId();
    if (!jobName || !scopeId) {
      return;
    }
    this.parametersLoading.set(true);
    this.svc.getJobParameters(scopeId, jobName).subscribe({
      next: params => {
        this.parameters.set(params);
        // Pre-fill defaults so the user only has to touch what they want to override.
        const defaults: Record<string, string> = {};
        for (const p of params) {
          if (p.defaultValue !== undefined && p.defaultValue !== null) {
            defaults[p.name] = p.defaultValue;
          }
        }
        this.paramValues.set(defaults);
        this.parametersLoading.set(false);
      },
      error: () => this.parametersLoading.set(false),
    });
  }

  protected setParamValue(name: string, value: string): void {
    this.paramValues.update(v => ({ ...v, [name]: value }));
  }

  protected submit(): void {
    const scopeId = this.scopeId();
    const jobName = this.jobName();
    if (!scopeId || !jobName) {
      return;
    }
    this.saving.set(true);
    this.svc.create(this.name(), { scopeIds: [scopeId], jobName, parameters: this.paramValues() }).subscribe({
      next: () => this.router.navigate(['..'], { relativeTo: this.route }),
      error: err => {
        this.saving.set(false);
        this.formErrors()?.reportError(err);
      },
    });
  }

  protected cancel(): void {
    this.router.navigate(['..'], { relativeTo: this.route });
  }
}
