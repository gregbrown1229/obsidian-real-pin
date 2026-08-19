# Improvement plans

One plan file per feature, each written to be executed independently (by a human
or an agent) on its own branch/PR. Every item was verified against the code as of
`main` at v1.3.1 — file/line references point at that state and should be
re-checked before implementing.

Effort: **S** = under half a day, **M** = 1–2 days.

## Part A — verified quick wins

| Plan | Title | Effort | Depends on |
| --- | --- | --- | --- |
| [a1](a1-focus-open-saved-group.md) | Focus instead of duplicating an already-open saved group | S | — |
| [a2](a2-block-mode-settings-copy.md) | Make the silent block mode discoverable in settings copy | S | — |
| ~~a3~~ | ~~Keyboard-fluent confirm modal~~ — **dropped**, Obsidian already does this (see below) | — | — |
| [a4](a4-confirm-saved-group-delete.md) | Confirm before deleting a saved group | S | — |
| [a5](a5-guard-commands-when-disabled.md) | Stop tab-group commands from silently mutating hidden state | S | — |
| [a6](a6-settings-structure.md) | Settings page structure, slider tooltip, dependent control | S | — |
| [a7](a7-saved-panel-polish.md) | Saved-groups panel: dead-end empty state, friendly member labels | S | — |
| [a8](a8-manifest-description.md) | Manifest/README describe all three features | S | — |

## Part B — ambitious features

| Plan | Title | Effort | Depends on |
| --- | --- | --- | --- |
| [b1](b1-close-guard-middle-click.md) | Middle-click and tab-× close protection | M | **Human sign-off required** (premise confirmed, see plan) |
| ~~b2~~ | ~~Pinned-aware "Close others" / "Close this tab group"~~ — **dropped**, Obsidian already does this | — | — |
| [b3](b3-close-group-chip-actions.md) | "Close group" / "Save and close group" chip actions | S/M | a4 (generalized confirm modal) |
| [b4](b4-pin-whole-group.md) | Pin/unpin a whole group | S | — |
| [b5](b5-keyboard-group-navigation.md) | Keyboard group navigation and move commands | M | — |
| [b6](b6-open-saved-group-in-split-window.md) | Open a saved group in a split or new window | M | a1 (focus-if-open precedence) |
| ~~b7~~ | ~~"Close all unpinned tabs in this tab group" command~~ — **dropped**, that is the built-in | — | — |
| [b8](b8-mobile-gating.md) | Mobile gating for tab-group settings | S | — |

## Dependency map

```
a4 ──▶ b3
a1 ──▶ b6
b1 ──▶ (blocked on human approval; premise verified)
everything else: independent
```

- **a4 → b3:** b3's pinned-member confirmation reuses the generalized modal.
- **a1 → b6:** b6 keeps a1's "focus if already open" as the uniform precedence
  rule for every open target, so a1's check must exist first.
- **b1** must not start until a human approves the capture-phase interception
  mechanism (CLAUDE.md prime directive 2). Spike S9 is **done** — see the plan.

## Dropped plans

- **a3 (keyboard-fluent confirm modal) — dropped, don't retry.** The premise was
  wrong. An e2e diagnostic against real Obsidian shows the modal **already**
  takes focus on open: Obsidian focuses the first button (**Cancel**) and never
  re-steals it. The dialog is keyboard-operable out of the box — Tab reaches
  "Close tab", Enter activates the focused button, Esc cancels — and
  Cancel-focused is the *safer* default for a destructive confirm. Adding code to
  move focus to the confirm button would override sensible platform behavior for
  no user-visible gain. (Focusing it *after* open does stick, since Obsidian
  steals focus exactly once — achievable, just not worth doing.) Closed unmerged
  as #15.

- **b2 (pinned-aware "Close others" / "Close this tab group") — dropped, don't
  retry.** Obsidian already skips pinned tabs in both. Probed against a real
  Obsidian with 2 pinned + 2 unpinned tabs open (active tab unpinned):
  `workspace:close-others` left **both pinned** (closing only the unpinned
  other), and `workspace:close-tab-group` left **both pinned** while closing
  both unpinned. b2 would have monkey-patched two commands to add protection
  that already exists. The README's "Scope" section claimed the opposite; fixed
  in #22.

- **b7 ("Close all unpinned tabs in this tab group") — dropped, don't retry.**
  That is precisely what the built-in `workspace:close-tab-group` does (same
  probe as b2: it closed both unpinned tabs and kept both pinned). Shipping our
  own command would duplicate a built-in under a different name.

- **a6's `setDynamicTooltip()` item — dropped.** Obsidian deprecated the method:
  "the value is now always shown inline next to the slider". The platform
  already shows the pixel value; adding the call would only trip
  `no-deprecated`. (Related: `PluginSettingTab.display()` is deprecated too, so
  re-rendering a settings tab to show/hide a dependent control is out — toggle
  the `Setting`'s `settingEl` instead. See #19.)

## Recommended order

1. **Wave 1 (no approvals):** a1, a2, a4–a8, b8 — all independent.
2. **Wave 2:** b3 + b4 (chip-menu cluster), then b5.
3. **Wave 3:** b1 (after sign-off), then b6.

## Ground rules (apply to every plan)

- `npm run check` green before every commit; `npm run build` for anything with
  runtime surface; e2e via `xvfb-run -a npm run test:e2e` where the plan says so.
- Non-trivial decision logic goes in `src/tabGroups/model.ts` (pure, unit-tested
  in `scripts/tabGroups.test.mjs`); Obsidian glue stays thin.
- Internal API only through the existing narrow guarded casts (`LeafInternal`,
  `TabsInternal`, `WorkspaceWithLeafById`), degrading to inert when absent.
- UI text is sentence case. Everything reverts on unload via `register*`.
- README (especially its "Scope" section) and settings descriptions are updated
  in the same PR as any behavior change.
