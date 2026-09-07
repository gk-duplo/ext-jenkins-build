import { Injectable, Inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

// Host-provided string DI tokens (no @common-lib import). REMOTE_DuploHttpClient exposes get/post
// returning RxJS Observables; REMOTE_UserSession carries the current tenant (.tenant.TenantId) —
// the same source the host's own resources use for the workspace id.
export const REMOTE_DuploHttpClient = 'REMOTE_DuploHttpClient';
export const REMOTE_UserSession = 'REMOTE_UserSession';

// This is a TYPED resource: the extension ships its own controller, so we call its OWN REST segment.
// originType/subType are used to look up the provisioning ticket via the origin-context endpoint —
// but this is WORKER mode, so there IS no provisioning ticket; ticketName()/track() are intentionally
// not exposed here (see 02-authoring-guide.md's Worker-mode FE rule).
const REST_SEGMENT = 'extensions/jenkins-builds';

export interface JenkinsArtifact {
  fileName?: string;
  relativePath?: string;
}

export interface JenkinsBuild {
  id: string;
  name: string;
  status: string;
  subStatus?: string;
  createdAt?: string;
  spec?: {
    scopeIds?: string[];
    jobName?: string;
    parameters?: Record<string, string>;
  };
  result?: {
    jobName?: string;
    jobUrl?: string;
    buildNumber?: number;
    buildUrl?: string;
    buildStatus?: string;
    startedAt?: string;
    finishedAt?: string;
    artifacts?: JenkinsArtifact[];
  };
}

export interface JenkinsJob {
  name: string;
  url: string;
}

export interface JenkinsJobParameter {
  name: string;
  type?: string;
  defaultValue?: string;
}

export interface ConsoleResponse {
  text: string;
  building: boolean;
  nextStart: number | null;
}

@Injectable({ providedIn: 'root' })
export class JenkinsBuildService {
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

  list(): Observable<JenkinsBuild[]> {
    return this.http.get(this.base()).pipe(map((r: any) => {
      const d = this.unwrap(r);
      return (d?.items ?? d ?? []) as JenkinsBuild[];
    }));
  }

  get(id: string): Observable<JenkinsBuild> {
    return this.http.get(`${this.base()}/${id}`).pipe(map((r: any) => this.unwrap(r)));
  }

  create(name: string, spec: { scopeIds: string[]; jobName: string; parameters: Record<string, string> }): Observable<JenkinsBuild> {
    return this.http.post(this.base(), { name, spec }).pipe(map((r: any) => this.unwrap(r)));
  }

  /** Hard delete — only for rows that never provisioned anything (reference/11). */
  remove(id: string): Observable<any> {
    return this.http.delete(`${this.base()}/${id}`);
  }

  /** Deprovision — best-effort abort of a still-running build (reference/11). */
  deprovision(id: string): Observable<any> {
    return this.http.post(`${this.base()}/${id}/deprovision`, {});
  }

  /** Workspace scopes — the Add form's Jenkins scope picker. */
  listScopes(): Observable<{ id: string; name: string }[]> {
    const url = `/v1/aiservicedesk/user/data/workspaces/${this.workspaceId()}/scopes`;
    return this.http.get(url).pipe(
      map((r: any) => ((this.unwrap(r) ?? []) as any[]).map(s => ({ id: s.id, name: s.name }))),
      catchError(() => of([])),
    );
  }

  /** Jenkins jobs available on the given scope's server — refreshed whenever the Add form's scope changes. */
  listJobs(scopeId: string): Observable<JenkinsJob[]> {
    const url = `${this.base()}/jobs?scopeId=${encodeURIComponent(scopeId)}`;
    return this.http.get(url).pipe(
      map((r: any) => (this.unwrap(r) ?? []) as JenkinsJob[]),
      catchError(() => of([])),
    );
  }

  /** The selected job's parameter definitions — feeds the Add form's dynamic parameter fields. */
  getJobParameters(scopeId: string, jobName: string): Observable<JenkinsJobParameter[]> {
    const url = `${this.base()}/jobs/${encodeURIComponent(jobName)}/parameters?scopeId=${encodeURIComponent(scopeId)}`;
    return this.http.get(url).pipe(
      map((r: any) => (this.unwrap(r) ?? []) as JenkinsJobParameter[]),
      catchError(() => of([])),
    );
  }

  /** Console log tail for the Logs tab — `start` is the character offset already rendered. */
  console(id: string, start = 0): Observable<ConsoleResponse> {
    const url = `${this.base()}/${id}/console?start=${start}`;
    return this.http.get(url).pipe(
      map((r: any) => this.unwrap(r) as ConsoleResponse),
      catchError(() => of({ text: '', building: false, nextStart: start })),
    );
  }

  /** Raw URL for one artifact's content — used both to fetch text content and as a download href. */
  artifactUrl(id: string, relativePath: string): string {
    return `${this.base()}/${id}/artifacts/${relativePath}`;
  }

  /** Fetches one artifact's content as text (for inline preview of text-like extensions). The backend
   * proxies raw bytes with Jenkins' content-type, so this is only meaningful for the text extensions the
   * Artifacts panel offers inline preview for; binary downloads use `artifactUrl()` directly instead. */
  getArtifactText(id: string, relativePath: string): Observable<string> {
    return this.http.get(this.artifactUrl(id, relativePath), { responseType: 'text' }).pipe(
      map((r: any) => (typeof r === 'string' ? r : this.unwrap(r))),
      catchError(() => of('')),
    );
  }
}
