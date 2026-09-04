## What this changes

<!-- One logical change per PR. What does it do, and why? -->

## How it was verified

<!-- CONTRIBUTING.md maps what you touched to how to verify it. Tick what you actually ran, and
     paste the output. "It works" without evidence is not verification. -->

- [ ] `./run.sh --reset`, then built **and** deployed a sample end to end
- [ ] `./scripts/build-extension.sh` on the affected sample, then deployed it and created one in the UI
- [ ] `npm ci && npm run build` in the affected `frontend/`
- [ ] `./stop.sh --wipe && ./run.sh` from a clean slate
- [ ] Ran `/duplo-extension` and confirmed the guidance still matches reality
- [ ] Docs only — no runtime behaviour changed

<details>
<summary>Output</summary>

```
paste the relevant command output here
```

</details>

## Blast radius

- [ ] **This changes `.env.example`** — image tags or ports here are adopted into every user's
      `.env` on their next `./run.sh` after an upgrade. Say so plainly above.
- [ ] This changes `scripts/upgrade_dev_kit.sh` or `scripts/init-project.sh` — the adoption path
- [ ] This changes a workflow under `.github/workflows/`
- [ ] None of the above

## Checks

- [ ] No `.env`, tokens, keys, or customer identifiers in the diff
- [ ] No build output committed — `dist/`, `node_modules/`, `**/bin/`, `**/obj/`, `backend/sdk-packages/`
- [ ] Commits are conventional, imperative, and focused
- [ ] If a vendored `ng-common-lib` tarball was added or bumped, its `NOTICE` sits beside it

<!-- Security fix? Don't describe the vulnerability here. Email ai-reporting@duplocloud.net. -->
