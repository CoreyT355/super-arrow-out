# Cleanup Plan — `GameScreen.svelte` Hardening

**Branch:** `cleanup/gamescreen-hardening` — new branch off `main`
**Status:** Proposed — not yet started
**Last updated:** 2026-05-31
**Companion to:** `refactor-all.md` (now **merged to `main`**; Step 9 produced `GameScreen.svelte`, and this picks up the follow-on issues a code review surfaced)

---

## Context

The `feature/refactor-all` work is **complete and merged to `main`** — the
integration branch is done, so this cleanup branches directly off `main`
(not off `feature/refactor-all`). Open one short-lived branch,
`cleanup/gamescreen-hardening`, and PR it back to `main`.

Step 9 of that refactor landed `GameScreen.svelte` as the owner of all runtime
game state. It works and passes the full safety net, but a principal-level
review flagged it as the one file where cleanliness dips below the bar set by
the rest of the refactor. Three issues are substantive enough to fix; two are
minor and tracked here so they don't get lost.

The surrounding architecture (stores, `panZoom` action, pure utils, thin
router) is held up as the reference — **this plan deliberately does not touch
it.** Scope is `GameScreen.svelte` plus the two `Board.svelte` a11y warnings.

Same regression bar as the parent refactor: **behavioral identity**, verified
by the Playwright e2e suite (19) + vitest units (55) + svelte-check clean. No
observable behavior may change.

---

## Issues, ranked

### 1. The boot-in-`onMount` cycle workaround ⚠️ HIGHEST VALUE

**Symptom (already fixed once, fragile):** Resume restore wrote `removed`,
while the auto-save `$effect` reads `removed` and writes `resumeStore.data`.
As two `$effect`s that formed a tracked read/write cycle, Svelte aborted with
`effect_update_depth_exceeded`, leaving the UI half-restored and unclickable.

**Current mitigation (commit `4685a76`):** boot moved into `onMount` + a
`cancelled` flag. This breaks the cycle because `onMount` is fire-once and
outside the reactive graph.

**Why it's still a smell:** `onMount` couples two unrelated concerns —
"run after mount" and "don't participate in the reactive cycle." The real
defect is that the auto-save effect re-triggers on the *hydration* write. The
next person to touch the save effect can silently reintroduce the cycle, and
the failure mode (frozen UI) is severe and non-obvious.

**Proposed fix — gate the save effect on a `booted` flag:**

```ts
let booted = false; // plain bool — set true at the end of boot

$effect(() => {
    // Read the deps so the effect still tracks them...
    const snapshot = { removed, markedRed, lives, won, lost };
    if (!booted) return;        // ...but skip the write until boot completes
    if (snapshot.won || snapshot.lost) { resumeStore.clear(); return; }
    if (snapshot.removed.size === 0) return;
    resumeStore.data = { /* ... */ };
});
```

Decision point to settle before coding:

- **Option A — `booted` flag (above).** Smallest diff. The boot can move back
  out of `onMount` into an `$effect` if we want, or stay in `onMount`; either
  way the cycle is broken at the *consumer*, which is where the bug actually
  lives. Keeps the fix legible.
- **Option B — wrap restore writes in `untrack`.** `untrack(() => { removed =
  ...; lives = ...; })` so the save effect never sees the hydration write as a
  dependency change. More precise, but `untrack` around a block of assignments
  reads as magic unless heavily commented.
- **Option C — leave `onMount` as-is, just document harder.** Cheapest, but
  doesn't remove the footgun.

**Recommendation:** Option A. It names the actual invariant ("don't persist
until we've finished loading") in plain code, and it's robust regardless of
whether boot is an effect or a lifecycle hook. Add a regression e2e:
resume a partial game → confirm clickable + a follow-up tap persists.

### 2. Duplicated round-teardown boilerplate

`reset()`, `regeneratePuzzle()`, and `goToMenu()` each repeat the same
clear sequence (`removed`, `markedRed`, `anims`, `lives`, rafId cancel, and
in two of them `winCounted`/`lostCounted`). Three near-identical copies is
exactly where drift bugs land (one forgets `markedRed`, etc.).

**Proposed fix — extract one helper:**

```ts
function clearRoundState({ counters = true } = {}) {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    removed   = new Set();
    markedRed = new Set();
    anims     = {};
    lives     = MAX_LIVES;
    if (counters) { winCounted = false; lostCounted = false; }
}
```

- `reset()` / `regeneratePuzzle()` call `clearRoundState()` then do their
  puzzle-source-specific work (`resumeStore.puzzle` vs `generateLevel`).
- `goToMenu()` calls `clearRoundState({ counters: false })` — note it
  currently does **not** reset `lives` or the counters before navigating; the
  `{#key}` remount handles a fresh mount, so the menu teardown only needs to
  stop the RAF loop and clear the visible board. **Verify this matches today's
  behavior exactly** before collapsing — `goToMenu` resetting `lives` where it
  didn't before would be a (likely harmless, but out-of-scope) behavior change.
  If the current asymmetry is intentional, encode it via the `counters`/opts
  rather than forcing uniformity.

This is the lowest-risk change and the safety net covers all three paths.

### 3. Shared `pathRefs` proxy — two writers, one object

`pathRefs` is a `$state` record written by **both** the parent (delete-on-drain
inside `loop`, line 183) and `Board` (`bind:this`). It works, but two writers
across a component boundary on one mutable proxy is invisible until someone
refactors `Board` and the deletes stop landing.

**Proposed action — document the ownership contract, don't re-architect.**
A full fix (events up, refs owned solely by `Board`) is more surface area than
the risk warrants for a single-player game. Instead:

- Add a contract comment at the `pathRefs` declaration spelling out: Board
  *populates* via `bind:this`; GameScreen *deletes* on drain; nobody reads a
  ref it didn't just write.
- Leave a `// TODO(ownership)` if we ever lift this into a shared/reused board.

Flag for discussion: is this worth the churn now, or purely a comment? Default
to comment-only unless we're already in the file for #1/#2.

### 4. `Board.svelte` prop-threading breadth (minor)

`Board` takes ~14 props, three of which (`darkMode`, `showGrid`,
`roundedCorners`) are settings it could read from the `settings` store directly
— the way `MenuScreen`/`StatsScreen` already do. The current "pure Board"
approach is defensible, but it's *inconsistent* with the rest of the app.

**Proposed action — deferred / optional.** Either:
- (a) Have `Board` import `settings` directly and drop those three props, for
  consistency; or
- (b) Explicitly document that `Board` is kept presentation-pure on purpose.

No behavior change either way. Lowest priority; do only if we want the
consistency. Recommendation: pick (b) and write one sentence — keeping the
board free of store coupling makes it trivially testable/snapshot-able, which
is a fine reason; we just need to *state* it so it doesn't read as an
oversight.

### 5. Two `Board.svelte` a11y warnings (minor, build-cleanliness)

The clickable `<g>` (~line 194) has no keyboard handler / ARIA role, producing
two svelte-check warnings. The board is operable via the `panZoom` action's
pointer/touch paths and the per-arrow `onArrowClick`, so this is about a clean
build, not a real keyboard-trap.

**Proposed fix:** add `role="button"` + `tabindex` + an `onkeydown` that maps
Enter/Space to the same handler, OR a scoped `<!-- svelte-ignore -->` with a
one-line justification if true keyboard play is out of scope for the game.
Decide which; either clears the warnings and gets the build to zero-warning.
(See `accessibility.md` if there's a broader a11y stance to align with.)

---

## Execution

All work happens on `cleanup/gamescreen-hardening` (branched off `main`),
PR'd back to `main`. Each item is independently shippable; bundle them into one
PR or split if review size warrants.

| Step | Change | Risk | Gate |
|---|---|---|---|
| A | `booted`-flag gate on the auto-save effect (#1) + resume regression e2e | Medium — touches the cycle that caused the freeze | Full Playwright + manual resume smoke |
| B | `clearRoundState()` extraction (#2) | Low | Playwright (covers reset/regen/menu paths) |
| C | `pathRefs` ownership comment (#3) | None | svelte-check |
| D | `Board` a11y warnings (#5) | Low | svelte-check zero-warning |
| E | `Board` settings-prop decision (#4) | None–Low | Playwright if (a) chosen |

Suggested order: **A → B → D → C → E.** A and B are the substance; D and C are
cheap cleanups; E is optional.

---

## Non-goals

- Re-architecting state ownership beyond `GameScreen` (stores, action, router
  stay as-is — they're the reference).
- Splitting `GameScreen` further. It's doing a lot (boot, RAF, save,
  win/lose/streak, vortex) but that cohesion is the screen's job; the fix is
  cleaner internals, not more files.
- Tailwind / CSS cleanup. Inline classes stay.
- Any observable behavior change. This is hardening, not features.

---

## Decision log

| Decision | Choice | Why |
|---|---|---|
| Fix the cycle at the consumer, not via `onMount` | `booted` flag (Option A) | Names the real invariant; robust whether boot is effect or hook; legible |
| Collapse the three teardown copies | Single `clearRoundState()` helper | Removes the drift-bug surface; verify `goToMenu` asymmetry first |
| `pathRefs` two-writer proxy | Document, don't re-architect | Risk doesn't justify the churn for a single-player board |
| `Board` settings props | Default: keep pure + document | Testability is a real reason; just state it so it's not an accident |
| a11y warnings | Clear to zero-warning build | Cheap; matches the polish bar of the rest of the refactor |
| Scope | `GameScreen.svelte` + `Board` a11y only | The review praised everything else as reference-quality |
