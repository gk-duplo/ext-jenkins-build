import { Injectable, Inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

// Host-provided string DI tokens (no @common-lib import). REMOTE_DuploHttpClient exposes get/post
// returning RxJS Observables; REMOTE_UserSession carries the current tenant (.tenant.TenantId) —
// the same source the host's own resources use for the workspace id.
export const REMOTE_DuploHttpClient = 'REMOTE_DuploHttpClient';
export const REMOTE_UserSession = 'REMOTE_UserSession';

// This is a TYPED resource: the extension ships its own controller, so we call its OWN REST segment.
// originType/subType are used to look up the provisioning ticket via the origin-context endpoint.
const ORIGIN_TYPE = 'HelloWorld';
const SUB_TYPE = 'hello-world';
const REST_SEGMENT = 'extensions/appstacks';

export interface HelloWorld {
  id: string;
  name: string;
  status: string;
  subStatus?: string;
  createdAt?: string;
  spec?: { firstName?: string; lastName?: string };
  result?: { fullName?: string };
}

@Injectable({ providedIn: 'root' })
export class HelloService {
  constructor(
    @Inject(REMOTE_DuploHttpClient) private http: any,
    @Inject(REMOTE_UserSession) private session: any,
  ) {}

  /** Current workspace/tenant id — from the host UserSession (route params aren't reliable in a MF remote). */
  workspaceId(): string {
    return this.session?.tenant?.TenantId ?? '';
  }

  private base(): string {
    return `/v1/aiservicedesk/user/data/workspaces/${this.workspaceId()}/environment/${REST_SEGMENT}`;
  }

  // The DuploHttpClient unwraps the API envelope to `data`; fall back defensively for either shape.
  private unwrap = (r: any) => (r && r.data !== undefined ? r.data : r);

  list(): Observable<HelloWorld[]> {
    return this.http.get(this.base()).pipe(map((r: any) => {
      const d = this.unwrap(r);
      return (d?.items ?? d ?? []) as HelloWorld[];
    }));
  }

  get(id: string): Observable<HelloWorld> {
    return this.http.get(`${this.base()}/${id}`).pipe(map((r: any) => this.unwrap(r)));
  }

  create(name: string, spec: { firstName: string; lastName: string }): Observable<HelloWorld> {
    const body = { name, spec };
    return this.http.post(this.base(), body).pipe(map((r: any) => this.unwrap(r)));
  }

  /** Resolve the provisioning ticket (its `name` is the chat URL segment) via origin-context. */
  ticketName(id: string): Observable<string | null> {
    const url = `/v1/aiservicedesk/tickets/${this.workspaceId()}/origin-context`
      + `?type=${ORIGIN_TYPE}&id=${id}&subType=${SUB_TYPE}`;
    return this.http.get(url).pipe(map((r: any) => this.unwrap(r)?.name ?? null));
  }

  /**
   * Declarative Result view-template for this resource type (the inherited GET …/view-template endpoint;
   * served from the `resources-frontend-templates/` we ship in the bundle — see 09-result-templates).
   * Resolves to null when none is registered, so the view falls back to plain cards.
   */
  getViewTemplate(type: string = ORIGIN_TYPE, subType: string = SUB_TYPE): Observable<any | null> {
    const q = `type=${encodeURIComponent(type)}&subType=${encodeURIComponent(subType)}`;
    return this.http.get(`${this.base()}/view-template?${q}`).pipe(
      map((r: any) => this.unwrap(r) ?? null),
      catchError(() => of(null)),
    );
  }
}
