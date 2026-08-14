# Agent Note: The popupSelect card sizes to its content, not the composer card

Status: implemented

English | [中文](2026-08-13-popup-select-content-width.zh.md)

## Problem

The popupSelect shell (`PopupSelectView` — the overlay behind a popup command such as `/model`) sized its card to the composer card, not to its content. The card is `position: absolute; left: 0` against the `conversation.input.overlay` anchor, and the anchor is exactly the composer card's width. Two lines of `PopupSelectView.module.css` pinned the width there:

```css
min-width: min(220px, 100%);
max-width: 100%; /* never wider than the composer card; long rows truncate */
```

Because `100%` resolves against the anchor (the composer card), the card could never exceed the composer card's width. Model names and detail rows wider than that — long ids like `deepseek-v4-rlasn` beside their provider/description detail — hit `text-overflow: ellipsis` and rendered truncated, exactly the `…` the user reported in the `/model` popup.

## Decision

The card keeps its shrink-to-fit width but the composer-card clamp is replaced by a viewport-fit one. `max-width: 100%` is removed from the CSS (the card is absolutely positioned with no `width`, so it already shrink-fits to its widest row), and a symmetric sibling of the existing `useAnchoredMaxHeight` clamps the design cap to the viewport:

- `packages/client/ui-primitives/src/useAnchoredMaxWidth.ts` — `useAnchoredMaxWidth(ref, cap, signal)` measures the space between the card's left edge and the viewport's right edge (minus the 12px portal margin) and returns `min(cap, that)` as the inline `max-width`.
- `PopupSelectView` applies both clamps inline: `style={{ maxHeight, maxWidth }}` with `MAX_HEIGHT = 320` (unchanged) and `MAX_WIDTH = 520`.

The design intent in the removed comment — "long rows truncate instead of pushing the card past the composer's edge" — is preserved, but the boundary moves from the composer card to the screen: long model names/descriptions now grow the card and show in full, while the right edge still never leaves the viewport. The hook mirrors `useAnchoredMaxHeight`'s contract (design cap init state, `signal`-driven re-measure, resize listener), so the two overlay hangs behave as one viewport-fit family.

## Alternatives considered

**Keep a fixed wider width (e.g. `min-width: 320px`).** Predictable but guesses a width that neither fits long names nor narrow viewports; rejected in favor of content-driven sizing.

**Use viewport units in CSS (`max-width: calc(100vw - Xpx)`).** The composer card is centered with a clearance we do not know, so `100vw`-based caps overshoot the right edge by the card's left offset. Rejected: the viewport fit needs the real measured `left`.

**Apply the same to the slash menu (`MenuView`).** The slash menu shares the `conversation.input.overlay` anchor and the `max-width: min(537px, 100%)` clamp, but its rows deliberately truncate (`itemName max-width: 40%`, descriptions `flex: 1`/ellipsis) on purpose. Kept out of this change.

## Consequences

- The `/model` popup (and any popupSelect command) grows with its widest row up to the 520px design cap, then to the viewport when the anchor sits low on a narrow screen; long model rows render in full instead of `…`.
- `useAnchoredMaxWidth` becomes a new public `ui-primitives` export, symmetric to `useAnchoredMaxHeight`, under the same per-file coverage gate (fully covered by the popup-view component spec).
- The slash menu keeps its composer-card-bounded width and intentional row truncation; no behavior change there.
- The composer card itself is untouched; only the floating overlay can now exceed it.

## Testing

`packages/client/ui-commands/tests/popup-view.client.spec.tsx` extends the two existing Geometry-clamp cases with their width analogues: it asserts `max-width` is `520px` when the anchor has room to the right, and clamps to the measured viewport space (`1024 - left - 12`) when the card sits near the right edge. `pnpm run test:gui` covers the two changed packages, and the assembled web client is replayed keyless (`DSH_SNAPSHOT=replay pnpm run test:web`) to confirm the assembled app still boots and renders.
