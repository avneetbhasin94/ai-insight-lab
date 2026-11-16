# Verification record

Checked 16 November 2026 against this prototype's NBA-only fixture pack.

## Automated checks

- `npm test`: **46 tests passed**, 0 failed (21 local engine tests and 25 optional pipeline tests).
- `npm run eval`: **31/31** hand-authored case statuses, source identities, expected evidence and expected numerical assertions passed; calculator checks passed.
- The tiny evaluation fixture reported 18/18 intent labels and 17/17 retrieval-hit-at-3 cases. These prompts are held out from the small classifier training examples, but not an independent benchmark. They do not demonstrate generalization, live sports correctness, prediction accuracy or calibrated probabilities.
- `npm run check`: syntax checks passed for the UI, local engine and optional server pipeline.
- Targeted recognizable-key and personal-email scan of this project's source files returned no matches. This is not proof that every possible secret or vulnerability has been detected.

## Independent review and fixes

A separate reviewer reproduced and verified fixes for cross-matchup nickname leakage, incorrect definition-versus-comparison routing, provenance/identity coercion, optional injury-question guards, stale scenario explanations and low text contrast. Original reproductions were rerun after fixes. Reviewed muted text now has approximately 4.84–5.68:1 contrast on the tested light panels.

No direct XSS/key-exposure path was found in the reviewed renderer: dynamic content uses text nodes, links come from the source register, browser requests are self-only, and no credentials are in the site. This is a focused review, not a penetration test or vulnerability-free certification.

## Browser checks actually performed

Managed Sites local preview in Chromium, including desktop, 500 CSS pixels and 400 CSS pixels. The narrow check used a resized browser plus browser zoom; it was not a real phone/device test.

- Rendered original dashboard, readable prototype banner, fixture cards, comparison panels, evidence panel and scenario controls.
- Searching Lakers returned its sample matchup; an unmatched query showed the empty state.
- Saving a matchup and enabling Saved filtered the cards correctly.
- Selecting Lakers/Warriors updated the context, metrics and synthetic baseline.
- Compare numbers displayed both teams' fixture values and units.
- A pace question returned the NBA glossary citation. A current-injury question explicitly abstained.
- At maximum hypothetical absence and rest for Lakers, the scenario and explanation calculated 51 − 10 − 5 = 36%, with 64% for the other side and a synthetic warning.
- The methodology dialog showed local session counters and honest working/mock-tested/planned statuses.
- At 400 CSS pixels, inspected the stacked responsive layout and confirmed no horizontal document overflow.

The hosted deployment is verified separately by native Sites status. A private sign-in gate may prevent signed-in hosted visual testing; do not confuse local browser QA with authenticated hosted verification.

## Remaining limits

No real provider credentials or subscription, no real injury/score/schedule/news requests, no live embedding or language-model calls, no trained outcome predictor, no chronological forecast backtest, no calibration record, no production abuse/load test, and no real-device assistive-technology audit. Optional model tests use fake adapters. Citation and numeric checks cannot prove arbitrary semantic truth. No public-access or GitHub publication was performed.
