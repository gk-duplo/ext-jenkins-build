# Custom result views — hand-written tabbed results for complex extensions

Most real extensions outgrow the declarative view-template. When the result needs anything beyond the
template-view's four field types (`single`/`multi`/`table`/`raw`) — charts, action buttons, live per-tab
fetches, conditional tabs, log consoles, per-row interactions — **write the Result panel yourself** as a
tabbed results section. The worked example is [`samples/network-stack`](../../../../samples/network-stack)
(tabs: **Overview | Network | Logs | Ask AI**).

**Choosing (the fork the authoring agent must make, per resource):**

| Result shape | Render with |
|---|---|
| flat fields / static tables the four field types cover | the declarative view-template — [09-result-templates](09-result-templates.md) |
| anything richer: live state, actions, logs, charts, conditional sections | a custom tabbed results section — this doc |

Don't default to either — decide from the settled Result fields and what the view must DO. When in doubt for
a non-trivial resource, custom tabs age better (the template is a ceiling, not a floor).

## Structure

The **outer shell stays the platform pattern** — `view-with-sidecards` + `view-header-card` with the
`app-flat-status-filter` **panel** switcher (Spec | Result | …). The tab strip lives **inside the Result
panel**, one `ngbNav` with per-tab content:

```html
@case ('result') {
  <div class="tabs">
    <ul ngbNav #resultNav="ngbNav" [(activeId)]="resultTab" class="nav-tabs px-1 pt-1">
      <li ngbNavItem="overview">
        <a ngbNavLink>Overview</a>
        <ng-template ngbNavContent>
          <ns-overview-panel [item]="it" />
        </ng-template>
      </li>
      <li ngbNavItem="network">
        <a ngbNavLink>Network</a>
        <ng-template ngbNavContent><ns-network-panel [item]="it" /></ng-template>
      </li>
      <li ngbNavItem="logs">
        <a ngbNavLink>Logs</a>
        <ng-template ngbNavContent><ns-logs-panel [item]="it" /></ng-template>
      </li>
      <!-- Ask AI (OPT-IN, when the user requested it) is ALWAYS the LAST tab — see 16-ask-ai -->
      <li ngbNavItem="ask-ai">
        <a ngbNavLink>Ask AI</a>
        <ng-template ngbNavContent><ns-ask-ai-panel [resource]="it" /></ng-template>
      </li>
    </ul>
    <div [ngbNavOutlet]="resultNav"></div>
  </div>
}
```

- `ngbNav` comes with `CommonLibComponentsModule` (it re-exports NgbModule) — no extra dependency.
- **Each tab body is its own standalone component** under `shared/` — self-contained fetch + state, reusable
  across resources. Small render-only sections can stay inline; anything with its own data belongs in a
  panel component.
- **Conditional tabs** are just `@if` around the `<li>` (e.g. a tab that only exists when the spec section
  is present or the result has data).

## Lazy loading — free, and it's the "tab opened" hook

`<ng-template ngbNavContent>` is not instantiated until the tab is first shown, so a panel component's
`ngOnInit` fires on first open — that IS the lazy-load hook. Panels fetch their own data there (usually a
**custom controller endpoint** per tab — see [05-custom-actions](05-custom-actions.md) §6). Only data that
lives on the parent needs an explicit `(activeIdChange)` handler.

## State: `[(activeId)]` wants a plain field, not a signal

ngbNav writes `activeId` from a template event, and a plain field repaints fine under OnPush — don't fight
it with a signal (precedent + comment: `samples/parent-child/frontend/src/app/parents/view-parent.component.ts`).
One field per nav:

```ts
protected resultTab = 'overview';   // plain field — ngbNav two-way binds it
```

Tab state is not URL-persisted by default; a reload lands on the first tab. Add a query param yourself if
deep-linking matters.

## Polling: start on non-terminal status, stop on terminal, unsubscribe on destroy

```ts
// Match the sample (and your platform's terminal/paused statuses) — polling must also stop on
// Blocked / WaitingForApproval or it loops forever against a stuck resource.
private static readonly TERMINAL = ['Complete', 'Failed', 'DeProvisioned', 'Blocked', 'WaitingForApproval'];
private poll?: Subscription;

private refresh(): void {
  this.svc.get(this.id).subscribe(i => {
    this.item.set(i);
    const inFlight = !ViewComponent.TERMINAL.includes(i?.status);
    if (inFlight && !this.poll) this.poll = interval(3000).subscribe(() => this.refresh());
    if (!inFlight && this.poll) { this.poll.unsubscribe(); this.poll = undefined; }
  });
}
ngOnDestroy(): void { this.poll?.unsubscribe(); }
```

A panel whose data keeps changing after the resource is terminal (e.g. live infra state) polls **itself** —
the parent's poll has stopped by then.

## Never a dead empty state

Until the result lands, render the **planned values from the spec** (labelled as planned/creating), not an
empty panel. Pair the sections on presence of the result field:

```html
@if (!it.result?.vpcId) { <!-- planned values from it.spec + a "Creating…" status line --> }
@if (it.result?.vpcId) { <!-- real values --> }
```

## Change-detection traps (all real, all painful)

- **`track` is load-bearing** in `@for` over arrays rebuilt by polling — without it every poll tick rebuilds
  the DOM nodes and clicks land on detached elements.
- **Memoize derived arrays** (or compute them in the fetch handler): a getter returning a fresh array every
  CD cycle churns child `input()`s every tick.
- Prefer **input setters / computed()** over method calls in templates for anything non-trivial.

## Trade-offs vs the declarative template

- You lose the template-view's `cardMenus`/`rowMenus` wiring ([05-custom-actions](05-custom-actions.md) §4) —
  custom views wire their own buttons/menus directly.
- You own the markup: follow [use-ng22] rules (standalone, signals, `@if/@for`, OnPush) — custom panels are
  YOUR code and must pass the ng22 verification gate (vendored `result-template/` was exempt; your panels
  are not).
- Rich-text rendering via `[innerHTML]` needs the `ViewEncapsulation.None` care described at the end of
  [09-result-templates](09-result-templates.md).

## Ask AI (opt-in) composes here

When the user explicitly requested Ask AI sessions ([16-ask-ai](16-ask-ai.md)), the Ask AI panel is the
**LAST tab of this strip** — never an entry in the outer Spec/Result switcher. A template-view (Option A)
extension that opts in wraps its `<app-resource-template-view>` as a single "Overview" tab and appends the
Ask AI tab after it.
