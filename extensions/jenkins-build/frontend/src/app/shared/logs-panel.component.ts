import { Component, DestroyRef, OnInit, inject, input, signal } from '@angular/core';
import { Subscription, interval } from 'rxjs';
import { CommonLibComponentsModule } from '@duplocloud-internal/ng-common-lib';
import { JenkinsBuild, JenkinsBuildService } from '../jenkins-build.service';
import { AnsiStripPipe } from './ansi-strip.pipe';
import { AutoScrollBottomDirective } from './auto-scroll-bottom.directive';

// Logs tab body: tails this resource's OWN {id}/console endpoint (which proxies Jenkins' consoleText and
// slices it server-side from `start`, matching the platform's usual polling-log-viewer contract —
// reference/05-custom-actions.md §6). Self-loads in ngOnInit — ngbNavContent instantiates a tab's content
// only when it is first shown, so ngOnInit IS the "tab opened" hook (reference/17).
//
// The panel owns its own tail poll: the PARENT's poll follows resource status, but the console log keeps
// growing while the build runs — tail it here every 3s while `building` is true, independent of the
// parent's poll cadence (reference/17: a panel whose data changes after the parent's poll stopped polls
// itself).
@Component({
  selector: 'jb-logs-panel',
  imports: [CommonLibComponentsModule, AnsiStripPipe, AutoScrollBottomDirective],
  styles: [`
    .console { background: #161d31; color: #d0d2d6; border-radius: 6px; padding: .75rem;
      min-height: 160px; max-height: 420px; overflow: auto; font-size: .8rem; white-space: pre-wrap; }
    .live-dot { width: 8px; height: 8px; border-radius: 50%; background: #28c76f; display: inline-block;
      margin-right: .35rem; animation: jb-pulse 1.2s ease-in-out infinite; }
    @keyframes jb-pulse { 50% { opacity: .35; } }
  `],
  template: `
    <div class="p-1">
      <div class="d-flex align-items-center mb-50">
        <h6 class="text-muted mb-0 mr-auto">Console</h6>
        @if (tailing()) {
          <span class="text-muted font-small-3"><span class="live-dot"></span>live</span>
        } @else {
          <button class="btn btn-outline-secondary btn-sm" (click)="reload()" [disabled]="loading()">
            {{ loading() ? 'Refreshing…' : 'Refresh' }}
          </button>
        }
      </div>

      @if (log(); as l) {
        <pre class="console" autoScrollBottom>{{ l | ansiStrip }}</pre>
      } @else if (loading()) {
        <p class="text-muted font-small-3">Loading console output…</p>
      } @else {
        <p class="text-muted font-small-3">No console output yet — it appears once the build starts.</p>
      }
    </div>
  `,
})
export class LogsPanelComponent implements OnInit {
  private readonly svc = inject(JenkinsBuildService);
  private readonly destroyRef = inject(DestroyRef);

  readonly item = input.required<JenkinsBuild>();

  protected readonly log = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly tailing = signal(false);

  private cursor = 0;
  private tail?: Subscription;

  ngOnInit(): void {
    this.reload();
    this.destroyRef.onDestroy(() => this.tail?.unsubscribe());
  }

  protected reload(): void {
    this.log.set(null);
    this.cursor = 0;
    this.stopTail();
    this.loading.set(true);
    this.fetch();
  }

  private fetch(): void {
    this.svc.console(this.item().id, this.cursor).subscribe(r => {
      this.loading.set(false);
      const soFar = (this.log() ?? '') + (r.text ?? '');
      this.log.set(soFar);
      this.cursor = r.nextStart ?? this.cursor;
      if (r.building && !this.tail) {
        this.tailing.set(true);
        this.tail = interval(3000).subscribe(() => this.fetch());
      }
      if (!r.building && this.tail) {
        this.stopTail();
      }
    });
  }

  private stopTail(): void {
    this.tail?.unsubscribe();
    this.tail = undefined;
    this.tailing.set(false);
  }
}
