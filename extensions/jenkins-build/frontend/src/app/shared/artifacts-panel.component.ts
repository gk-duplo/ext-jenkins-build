import { Component, computed, inject, input, signal } from '@angular/core';
import { CommonLibComponentsModule, downloadFileByUrl } from '@duplocloud-internal/ng-common-lib';
import { JenkinsArtifact, JenkinsBuild, JenkinsBuildService } from '../jenkins-build.service';

const TEXT_EXTENSIONS = new Set(['.txt', '.log', '.json', '.xml', '.yml', '.yaml', '.md', '.csv']);

function isTextArtifact(relativePath: string | undefined): boolean {
  if (!relativePath) {
    return false;
  }
  const dot = relativePath.lastIndexOf('.');
  if (dot < 0) {
    return false;
  }
  return TEXT_EXTENSIONS.has(relativePath.slice(dot).toLowerCase());
}

// Artifacts tab body: lists Result.Artifacts. Text-like extensions (.txt/.log/.json/.xml/.yml/.md/.csv)
// get an inline "View" action that fetches the content via the backend's artifact proxy and shows it in a
// <pre>; everything else is a "Download" action that streams the raw bytes as a browser download.
@Component({
  selector: 'jb-artifacts-panel',
  imports: [CommonLibComponentsModule],
  styles: [`
    .console { background: #161d31; color: #d0d2d6; border-radius: 6px; padding: .75rem;
      max-height: 360px; overflow: auto; font-size: .8rem; white-space: pre-wrap; }
  `],
  template: `
    @if (item(); as it) {
      <div class="p-1">
        @if (artifacts().length) {
          <table class="table table-sm">
            <thead><tr><th>File</th><th></th></tr></thead>
            <tbody>
              @for (a of artifacts(); track a.relativePath) {
                <tr>
                  <td>{{ a.fileName || a.relativePath }}</td>
                  <td class="text-right">
                    @if (isText(a)) {
                      <button class="btn btn-outline-primary btn-sm" (click)="view(a)">View</button>
                    } @else {
                      <button class="btn btn-outline-secondary btn-sm" (click)="download(a)">Download</button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <p class="text-muted font-small-3">
            {{ it.result?.buildStatus ? 'No artifacts were published by this build.' : 'Artifacts appear once the build finishes.' }}
          </p>
        }

        @if (viewing(); as v) {
          <h6 class="text-muted mt-1">{{ v }}</h6>
          @if (viewLoading()) {
            <p class="text-muted font-small-3">Loading…</p>
          } @else {
            <pre class="console">{{ viewContent() }}</pre>
          }
        }
      </div>
    }
  `,
})
export class ArtifactsPanelComponent {
  private readonly svc = inject(JenkinsBuildService);

  readonly item = input.required<JenkinsBuild>();

  protected readonly artifacts = computed<JenkinsArtifact[]>(() => this.item().result?.artifacts ?? []);

  protected readonly viewing = signal<string | null>(null);
  protected readonly viewContent = signal('');
  protected readonly viewLoading = signal(false);

  protected isText(a: JenkinsArtifact): boolean {
    return isTextArtifact(a.relativePath);
  }

  protected view(a: JenkinsArtifact): void {
    if (!a.relativePath) {
      return;
    }
    this.viewing.set(a.fileName || a.relativePath);
    this.viewLoading.set(true);
    this.viewContent.set('');
    this.svc.getArtifactText(this.item().id, a.relativePath).subscribe(text => {
      this.viewContent.set(text);
      this.viewLoading.set(false);
    });
  }

  protected download(a: JenkinsArtifact): void {
    if (!a.relativePath) {
      return;
    }
    const url = this.svc.artifactUrl(this.item().id, a.relativePath);
    downloadFileByUrl(url, a.fileName || a.relativePath);
  }
}
