import { Component, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormGroupErrorsComponent, SharedFormsModule } from '@duplocloud-internal/ng-common-lib';
import { HelloService } from '../hello.service';

// Create form in the platform's 3-column `panel-form-accordion` layout: title+description (left), inputs
// (center), per-field help (right). The platform ships these column widths as an SCSS *mixin* that each
// host component @includes (it is NOT global CSS, and the published lib ships compiled CSS only) — so a
// remote must carry the layout rules in its own component `styles` (below).
//
// Forms stay template-driven, but each field is a signal bound one-way with an explicit (ngModelChange)
// writer: `[(ngModel)]="sig"` would compile to `sig = $event`, which cannot assign to a signal. Signals
// also keep the component correct under Angular 22's default OnPush strategy.
@Component({
  selector: 'hw-add',
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
          <h4 class="font-weight-bolder">Create Hello World</h4>
          <p class="panel-content-title-sub-text text-muted">
            Enter a name and the person's first / last name. The agent combines them into a full name.
          </p>
        </div>

        <div class="panel-content-form">
          <form name="AddHelloForm" #f="ngForm" class="form form-vertical" (ngSubmit)="f.valid && submit()">
            <div class="form-container" form-group-errors #formGroupErrors showDetailsWhen="submitted">
              <form-field>
                <label class="element-label">Name *</label>
                <!-- Keep the hyphen escaped: browsers compile pattern with the RegExp v flag, under
                     which a bare hyphen in a character class throws and the validator fails open. -->
                <input type="text" class="form-control" name="name"
                       [ngModel]="name()" (ngModelChange)="name.set($event)"
                       placeholder="e.g. greet-jane" required validation-state validation-errors
                       minlength="2" maxlength="60" pattern="^[a-zA-Z0-9]([a-zA-Z0-9\\-]*[a-zA-Z0-9])?$" />
              </form-field>
              <form-field>
                <label class="element-label">First Name *</label>
                <input type="text" class="form-control" name="firstName"
                       [ngModel]="firstName()" (ngModelChange)="firstName.set($event)"
                       placeholder="Jane" required validation-state validation-errors />
              </form-field>
              <form-field>
                <label class="element-label">Last Name *</label>
                <input type="text" class="form-control" name="lastName"
                       [ngModel]="lastName()" (ngModelChange)="lastName.set($event)"
                       placeholder="Doe" required validation-state validation-errors />
              </form-field>

              <div class="d-flex justify-content-end mt-1">
                <button type="button" class="btn btn-outline-secondary mr-1" (click)="cancel()">Cancel</button>
                <button type="submit" class="btn btn-primary" [disabled]="saving()">Provision</button>
              </div>
            </div>
          </form>
        </div>

        <div class="panel-content-sidenav">
          <div class="help-item">
            <p class="help-item-title">Name</p>
            <small class="text-muted">A unique identifier for this Hello World resource.</small>
          </div>
          <div class="help-item">
            <p class="help-item-title">First / Last Name</p>
            <small class="text-muted">The provisioning agent concatenates these into <code>fullName</code>.</small>
          </div>
        </div>

      </div>
    </div>
  `,
})
export class AddHelloComponent {
  private readonly svc = inject(HelloService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly name = signal('');
  protected readonly firstName = signal('');
  protected readonly lastName = signal('');
  protected readonly saving = signal(false);

  // Platform error reporter: the form-group-errors directive (already on the <form>) surfaces the real
  // API error via extractErrorMessage. viewChild() returns a signal — call it.
  private readonly formErrors = viewChild(FormGroupErrorsComponent);

  protected submit(): void {
    this.saving.set(true);
    this.svc.create(this.name(), { firstName: this.firstName(), lastName: this.lastName() }).subscribe({
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
