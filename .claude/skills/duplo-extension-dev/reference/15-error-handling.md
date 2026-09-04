# 15 — Surfacing API errors in the frontend

When a create/update fails, users must see the **real reason** — not a generic "Invalid request". This is the #1
form papercut, and it's caused by reading the wrong field of the error response.

## The API error shape (know this)

Every resource create/update failure returns HTTP `400` with an `ApiResponse` envelope:
```json
{ "success": false, "message": "Invalid request", "errors": "Resource with name 'foo' already exists" }
```
- **`message`** = a generic **title** (`"Invalid request"` / `"Error creating resource"` / `"Validation error"`) —
  hardcoded by the base controller.
- **`errors`** = the **real, human-readable reason** (`ex.Message`) — a plain string on all create paths.

So reading `err.error.message` shows the useless title and **drops the real reason in `err.error.errors`**. That is
the bug behind "Invalid request".

## Do this — reuse the platform's error reporter

The vendored lib `@duplocloud-internal/ng-common-lib` (already imported via `SharedFormsModule`) ships the whole
mechanism. **Do not read `err.error.message` yourself.**

### Standard forms → `formGroupErrors.reportError(err)`
The `form-group-errors` directive you already mount for client-side validation also implements `ErrorReporter`.
Grab it and report the raw error — it unwraps via `extractErrorMessage` (which reads `errors` → `Message` →
`message` → string) and renders the reason as the form's summary banner. This is the portal convention.
```ts
import { Component, ViewChild } from '@angular/core';
import { FormGroupErrorsComponent } from '@duplocloud-internal/ng-common-lib';

@ViewChild(FormGroupErrorsComponent) private formErrors?: FormGroupErrorsComponent;

submit() {
  this.svc.create(this.name, this.model).subscribe({
    next: () => this.router.navigate(['..'], { relativeTo: this.route }),
    error: (err) => { this.saving = false; this.formErrors?.reportError(err); },
  });
}
```
Template (already present in the templates): `<div class="form-container" form-group-errors #formGroupErrors
showDetailsWhen="submitted"> … </div>`. No bespoke `<div class="alert">` needed — the directive renders the banner.
See `samples/helloworld` and the `templates/helloworld` add form.

### Custom error placement → `extractErrorMessage(err)`
When you render the error somewhere the directive can't reach (e.g. a wizard's own error slot), use the extractor
directly to get the real string:
```ts
import { extractErrorMessage } from '@duplocloud-internal/ng-common-lib';
error: (err) => { this.saving = false; this.error = extractErrorMessage(err); }
```
See `samples/network-stack`'s add wizard (feeds `<duplo-wizard-stepper [error]>`).

## Constraints / notes

- **No cross-boundary toast.** The host exposes no `REMOTE_` alerts/toast token, so an extension remote can't raise
  the host toast service. Report **inline** (form banner / wizard slot) — that works fully inside the remote.
- **No field-level error map.** On create, `errors` is a single string, not a per-field dict — surface it as one
  message; don't expect to map it onto individual fields.
- **Where the real message comes from:** e.g. the name-uniqueness check throws
  `ArgumentException("<Type> with name '<n>' already exists")`, which the base controller puts into `errors`. Your
  own `OnBeforeCreateAsync` / `ValidateSpecAsync` throws surface the same way — throw with a clear message and it
  reaches the user via the above.
