# Homepage Hero Title Line Break

## Goal

Refine the homepage hero title so its hierarchy is calmer and its wording reads as two intentional units.

## Approved composition

- Render the title as two explicit lines:
  - `产业研究`
  - `交易与 AI 应用`
- Keep each line intact on desktop instead of relying on automatic browser wrapping.
- Reduce the desktop title scale by roughly 15% relative to the current treatment.
- Preserve the existing Deep Value Editorial typography, color, weight, and cinematic hero composition.
- Continue using responsive sizing on narrow screens so the second line does not cause horizontal overflow.

## Implementation boundary

Only the homepage hero title markup and its responsive typography may change. The eyebrow, introduction, background artwork, navigation, and downstream homepage modules remain unchanged.

## Verification

- Desktop rendering shows exactly two title lines in the approved order.
- A 390-pixel viewport has no horizontal overflow.
- The full test suite and production build pass.
