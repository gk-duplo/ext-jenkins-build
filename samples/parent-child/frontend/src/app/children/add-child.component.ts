import { Component, OnInit, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormGroupErrorsComponent, SharedFormsModule } from '@duplocloud-internal/ng-common-lib';
import { ParentChildService } from '../parentchild.service';

// Create form in the platform 3-column `panel-form-accordion` layout. parentId comes from the nested route;
// the backend stamps Spec.ParentId.
@Component({
  selector: 'pc-add-child',
  imports: [SharedFormsModule],
  styles: [`
    :host { display: block; }
    .panel-form-accordion { background: #fff; padding: 1.25rem 0 1rem 1.5rem; }
    .panel-content-title { width: 265px; min-width: 265px; }
    .panel-content-title-sub-text { max-width: 220px; }
    .panel-content-form { max-width: 768px; flex: 1 1 auto; margin: 0 1rem; padding: 0 1rem; }
    .panel-content-sidenav { width: 265px; min-width: 265px; margin-left: 2rem; }
    .panel-content-sidenav .help-item { padding-bottom: 1rem; }
    .panel-content-sidenav .help-item-title { margin: 0; font-weight: 600; font-size: 0.9rem; }
  `],
  template: `
    <div class="card panel-form-accordion">
      <div class="d-flex justify-content-between">
        <div class="panel-content-title">
          <h4 class="font-weight-bolder">Add Child</h4>
          <p class="panel-content-title-sub-text text-muted">A child belongs to a parent. The agent echoes the note as a message.</p>
        </div>
        <div class="panel-content-form">
          <form name="AddChildForm" #f="ngForm" class="form form-vertical" (ngSubmit)="f.valid && submit()">
            <div class="form-container" form-group-errors showDetailsWhen="submitted">
              <form-field>
                <label class="element-label">Name *</label>
                <!-- Keep the hyphen escaped: browsers compile pattern with the RegExp v flag,
                     under which a bare hyphen in a class throws and the validator fails open. -->
                <input type="text" class="form-control" name="name" [(ngModel)]="name"
                       required validation-state validation-errors minlength="2" maxlength="60"
                       pattern="^[a-zA-Z0-9]([a-zA-Z0-9\\-]*[a-zA-Z0-9])?$" />
              </form-field>
              <form-field>
                <label class="element-label">Note</label>
                <input type="text" class="form-control" name="note" [(ngModel)]="note" validation-state validation-errors />
              </form-field>
              <div class="d-flex justify-content-end mt-1">
                <button type="button" class="btn btn-outline-secondary mr-1" (click)="cancel()">Cancel</button>
                <button type="submit" class="btn btn-primary" [disabled]="saving()">Provision</button>
              </div>
            </div>
          </form>
        </div>
        <div class="panel-content-sidenav">
          <div class="help-item"><p class="help-item-title">Name</p>
            <small class="text-muted">A unique identifier for the child under this parent.</small></div>
          <div class="help-item"><p class="help-item-title">Note</p>
            <small class="text-muted">Optional; the agent echoes it into <code>result.message</code>.</small></div>
        </div>
      </div>
    </div>
  `,
})
export class AddChildComponent implements OnInit {
  private readonly svc = inject(ParentChildService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected name = '';
  protected note = '';
  protected readonly saving = signal(false);

  // Platform error reporter: the form-group-errors directive (already on the <form>) surfaces the real
  // API error via extractErrorMessage (reads response `errors`, not just the generic `message` title).
  private readonly formErrors = viewChild(FormGroupErrorsComponent);
  private parentId = '';

  ngOnInit(): void {
    this.parentId = this.route.snapshot.params['parentId'];
  }

  protected submit(): void {
    this.saving.set(true);
    this.svc.createChild(this.parentId, this.name, this.note).subscribe({
      next: () => this.backToParent(),
      error: err => {
        this.saving.set(false);
        this.formErrors()?.reportError(err);
      },
    });
  }

  protected cancel(): void {
    this.backToParent();
  }

  // '../..', not '..': this route's path is the four segments `view/:parentId/children/add`, so one pop
  // lands on `view/:parentId/children`, which matches no route. Same depth view-child's back() uses.
  private backToParent(): void {
    this.router.navigate(['../..'], { relativeTo: this.route });
  }
}
