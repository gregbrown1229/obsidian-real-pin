# a6 — Settings page structure, slider tooltip, dependent control

**Effort:** S · **Depends on:** nothing

## Problem

`src/settings.ts`:

1. The first three settings float with no section heading while only tab
   groups gets one (`display()`, `settings.ts:55-76`) — the three features
   aren't legible as distinct.
2. The **Compact tab width** slider (`settings.ts:125-135`) lacks
   `.setDynamicTooltip()`, so users can't see the pixel value they're
   choosing.
3. **Compact tab width** is always visible even when **Compact pinned tabs**
   is off — a dependent control with no effect.

## Change

All in `src/settings.ts`:

1. Add headings: keep the close-confirmation toggle at the top **unheaded**
   (Obsidian's plugin guidelines discourage a heading over the first/general
   section), then `new Setting(containerEl).setName("Compact pinned tabs").setHeading()`
   before the compact pair, keeping the existing "Tab groups" heading. Adjust
   the compact toggle's name to just "Compact pinned tabs" → rename the toggle
   row to e.g. "Shrink pinned tabs to icons" if the heading would duplicate
   it; keep sentence case.
2. Add `.setDynamicTooltip()` to the slider chain.
3. Hide the width slider when the toggle is off: the toggle's `onChange`
   already saves + applies — add `this.display()` to re-render the tab, and
   wrap the slider block in `if (this.plugin.settings.compactPinnedTabs)`.
   (Re-rendering on toggle is the idiom Obsidian setting tabs use for
   dependent controls; no per-element show/hide state.)

## Verification

- Manual pass over the settings tab (screenshot in PR): headings present,
  slider tooltip shows px value, slider hidden/shown as the toggle flips, both
  still apply live.
- `npm run check` (the `obsidianmd` lint set validates sentence case and
  settings idioms); `npm run build`.
