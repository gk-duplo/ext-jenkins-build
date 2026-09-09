import { Injectable, Inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export const REMOTE_DuploHttpClient = 'REMOTE_DuploHttpClient';
export const REMOTE_UserSession = 'REMOTE_UserSession';

const ORIGIN_TYPE = 'MathOps';
const SUB_TYPE = 'math-ops';
const REST_SEGMENT = 'extensions/math-ops';

export interface MathOpsSpec {
  a?: number;
  b?: number;
}

export interface MathOps {
  id: string;
  name: string;
  status: string;
  subStatus?: string;
  createdAt?: string;
  spec?: MathOpsSpec;
  result?: {
    sum?: number;
    difference?: number;
    product?: number;
    quotient?: number | null;
    remainder?: number | null;
    power?: number;
    min?: number;
    max?: number;
    average?: number;
  };
}

@Injectable({ providedIn: 'root' })
export class MathOpsService {
  constructor(
    @Inject(REMOTE_DuploHttpClient) private http: any,
    @Inject(REMOTE_UserSession) private session: any,
  ) {}

  workspaceId(): string {
    return this.session?.tenant?.TenantId ?? '';
  }

  private base(): string {
    return `/v1/aiservicedesk/user/data/workspaces/${this.workspaceId()}/environment/${REST_SEGMENT}`;
  }

  private unwrap = (r: any) => (r && r.data !== undefined ? r.data : r);

  list(): Observable<MathOps[]> {
    return this.http.get(this.base()).pipe(map((r: any) => {
      const d = this.unwrap(r);
      return (d?.items ?? d ?? []) as MathOps[];
    }));
  }

  get(id: string): Observable<MathOps> {
    return this.http.get(`${this.base()}/${id}`).pipe(map((r: any) => this.unwrap(r)));
  }

  create(name: string, spec: MathOpsSpec): Observable<MathOps> {
    const body = { name, spec };
    return this.http.post(this.base(), body).pipe(map((r: any) => this.unwrap(r)));
  }

  // Name of the provisioning ticket that created this resource (null when none is linked).
  ticketName(id: string): Observable<string | null> {
    const url = `/v1/aiservicedesk/tickets/${this.workspaceId()}/origin-context`
      + `?type=${ORIGIN_TYPE}&id=${id}&subType=${SUB_TYPE}`;
    return this.http.get(url).pipe(map((r: any) => this.unwrap(r)?.name ?? null));
  }

  getViewTemplate(type: string = ORIGIN_TYPE, subType: string = SUB_TYPE): Observable<any | null> {
    const q = `type=${encodeURIComponent(type)}&subType=${encodeURIComponent(subType)}`;
    return this.http.get(`${this.base()}/view-template?${q}`).pipe(
      map((r: any) => this.unwrap(r) ?? null),
      catchError(() => of(null)),
    );
  }
}
