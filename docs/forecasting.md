# NBA forecasting foundation

**Status: working offline code with synthetic correctness tests. No real-data trained model, live forecast endpoint, durable prediction history, calibrated probabilities, or measured NBA prediction performance is deployed.** This module is intentionally separate from the dashboard's synthetic scenario percentages. Neither set of numbers establishes a future win rate.

The product direction is to produce a forecast before tip-off, show the evidence and factors actually used, save the unchanged forecast, and compare every prediction with the final outcome, including misses. The code below implements the mathematical and temporal foundation for that workflow. It does not claim 60–70% daily accuracy or any guaranteed accuracy. Outcome accuracy is distinct from betting profitability; no odds, margins, or returns are calculated here.

## Explain it in an interview

“I started with an interpretable baseline that learns team strength from final scores. It turns the rating difference into a raw probability, with a disclosed fixed home advantage. I replay predictions chronologically using only snapshots available before each prediction, compare them with a simple training-only baseline, and measure accuracy, probability error, and reliability. The record helpers preserve the inputs and timestamps in memory. Real ingestion, durable storage, and calibration still need implementation and validation.”

This is a statistical predictive model, separate from language-model Q&A or RAG. Connecting an API or retrieving documents does not train, validate, or calibrate this model.

## What runs, and where

| Concept | Implementation and status | Inspect or evaluate |
| --- | --- | --- |
| Learned predictive baseline | **Working offline:** `trainEloModel` in [server/forecast.mjs](../server/forecast.mjs) updates team ratings from chronological final results. K factor and home advantage are fixed assumptions, not learned parameters. | `node --test --test-name-pattern='Elo learns' tests/forecast.test.mjs` verifies chronological determinism, conservation, and an exact Elo update. |
| Deterministic numerical tool | **Working:** `predictPregame` computes raw home/away probabilities from ratings and the explicit home assumption. Both teams must have training ratings. | `node --test --test-name-pattern='exact used factors' tests/forecast.test.mjs` recomputes the probability independently. |
| Structured outputs | **Working locally:** strictly validated input shapes, bounded numerical fields, explicit lifecycle states, and deeply frozen prediction/result objects. Only module-created models and records are accepted in this runtime. Serialized model loading is **planned**. | `node --test --test-name-pattern='invalid arrays\|scores, final lifecycle' tests/forecast.test.mjs` checks malformed values, NaN, extra fields, and future-result inputs. |
| Grounding and provenance | **Working as a local contract:** evidence IDs, source kind, source name, and retained retrieval time accompany every input. Synthetic or mixed evidence stays labelled. This module does not fetch or independently authenticate evidence. | Inspect `game`, `provenance`, and `predictPregame`; run `node --test --test-name-pattern='provenance\|data-kind' tests/forecast.test.mjs`. |
| Actual model-used factors | **Working:** home/away Elo, team training counts, fixed home advantage, and the Elo scale appear in `inputs.used`. Injuries, efficiency statistics, rest, lineups, player stats, and odds appear in `inputs.excluded`; they have no numerical weights. | Inspect `predictPregame` and its `inputs` output in the exact-factor test. |
| Chronological evaluation / leakage checks | **Working offline:** `evaluateWalkForward` predicts at an explicit pregame timestamp, then allows an earlier game's final result to affect subsequent ratings only after its retained availability time. Training and evaluation IDs must be disjoint. | `node --test --test-name-pattern='walk-forward\|future score\|late-arriving\|evaluation timestamp' tests/forecast.test.mjs`. |
| Accuracy and numerical evaluation | **Working:** accuracy, Brier score, log loss, ten reliability bins, expected calibration error, and sample counts are computed on every held-out prediction, including misses. A constant home-win probability is fitted only to initial training games. | `node --test --test-name-pattern='accuracy, Brier\|comparator' tests/forecast.test.mjs` checks formulas and extreme baseline misses. |
| Probability calibration | Reliability **measurement is working**. A fitted calibration transform, confidence intervals, and real-data calibration validation are **planned**. `raw-uncalibrated` is retained in every result. | Inspect `scoreMetrics`; bins describe errors and do not repair them. |
| Pregame forecast freeze | **Working in memory:** `freezePredictionRecord` fixes the model version, game ID, prediction ID, timestamp, input values, exclusions, and provenance. Timestamp changes and at/after-tip timestamps are rejected. | `node --test --test-name-pattern='forecast records freeze' tests/forecast.test.mjs`. |
| Outcome history including misses | **Working in memory:** `settlePredictionRecord` returns a separate outcome event with correctness, final-score evidence, and Brier error. It never overwrites the forecast and rejects a second settlement for the same object. Durable append-only storage and correction events are **planned**. | `node --test --test-name-pattern='settlement' tests/forecast.test.mjs`. |
| Observability | Reproducible per-prediction inputs and per-game evaluation rows are **working**. Production event tracing, failure/latency dashboards, and drift monitoring are **planned**. No external calls or logging of user text occur in this module. | Inspect the returned `rows`, `training`, and `inputs` objects. |
| Cost controls | **Working by construction:** no network, language model, embedding model, database, secrets, or paid calls. Input game collections are bounded. Production shared-cache/quota integration is **planned**. | The standalone test command below runs without credentials or network. |
| RAG, embeddings, prompt defense, agents, MCP | **Not implemented by this forecasting module.** Forecasts use deterministic numerical code, not natural-language tool selection or generated probabilities. See [the AI concept guide](ai-concepts.md) for the independently implemented Q&A boundaries. | Do not describe the Elo module as RAG, an LLM, or an autonomous agent. |

Run the complete bounded foundation test suite:

```sh
node --check server/forecast.mjs
node --test tests/forecast.test.mjs
```

All games in [tests/forecast.test.mjs](../tests/forecast.test.mjs) are fabricated temporal fixtures. Their reported hit rates and probability errors are **correctness-test output, not evidence of predictive ability**. They are deliberately not presented as NBA backtest results.

## Model and time contracts

The raw probability is:

```text
p(home wins) = 1 / (1 + 10 ^ ((awayElo - homeElo - fixedHomeAdvantage) / 400))
homeElo += K * (homeWon - p)
awayElo -= K * (homeWon - p)
```

Defaults are an initial rating of 1500, K = 20, and home advantage = 65 Elo points. These are transparent starting assumptions; no tuning result or injury-effect estimate is claimed. Score margin is unused. A tied NBA final is rejected rather than silently treated as a half-win or skipped. A 0.5 forecast selects the home team consistently for accuracy calculation.

Training requires 200 games by default. The configurable software floor is 50; lowering it only permits engineering experiments. **Neither 50 nor 200 games establishes a validated model.** A real assessment needs suitable team/season coverage, at least 200 usable training games as the initial guard, substantially broader evaluation across multiple chronological periods, and enough held-out results to assess uncertainty and calibration. No fixed sample count promises a particular accuracy.

Every final game requires these fields:

```js
{
  id: 'provider-game-id', homeTeamId: 'BOS', awayTeamId: 'NYK',
  tipoffAt: '2026-01-01T00:00:00.000Z',
  finalizedAt: '2026-01-01T02:30:00.000Z',
  knownAt: '2026-01-01T02:35:00.000Z',
  status: 'final', homeScore: 110, awayScore: 100,
  evidenceIds: ['retained-snapshot-id'],
  provenance: {
    kind: 'connected', source: 'Verified provider snapshot',
    retrievedAt: '2026-01-01T02:35:00.000Z'
  }
}
```

This is an illustrative **schema**, not a real NBA game or connected evidence. `knownAt` means the time this snapshot was actually retained; `retrievedAt` must match it. Finalization must follow tip-off, availability must follow finalization, and both must be no later than the training cutoff. Games update Elo in availability order, with a deterministic timestamp/ID tie-break. Calendar dates, local timestamps, UTC offsets, impossible dates, arrays in object fields, strings in numeric fields, NaN, duplicate IDs, and tied finals fail validation.

A scheduled game has the same identity, teams, tip-off, evidence, and provenance fields with `status: 'scheduled'`, and omits `finalizedAt`, `homeScore`, and `awayScore`. Its snapshot must be known before tip-off. Forecast creation must satisfy:

```text
training cutoff <= createdAt
schedule knownAt <= createdAt < tipoffAt
```

An evaluation item is `{ game: scheduledGame, result: finalGame, predictionAt: utcTimestamp }`. Schedule and result identities must match. The result is retained for scoring but cannot affect its own forecast. Previously scored evaluation results update later Elo forecasts only when their `knownAt` allows it. The comparator's home-win rate remains fitted on the original training set throughout evaluation.

Input timestamps are assertions from a trusted caller. Pure offline functions cannot prove a snapshot was actually retained then, prove creation happened before a real-world tip-off, authenticate evidence IDs, or prevent a caller from inventing/backdating an entire dataset. A production integration must obtain creation time from a trusted server clock and preserve independently auditable snapshots; historical results fetched today must not be assigned invented pregame availability times.

## Record lifecycle and limitations

The intended call sequence is `trainEloModel` → `predictPregame` → `freezePredictionRecord` → `settlePredictionRecord`. Model settings, training IDs/counts, raw probability, source lineage, used factors, and excluded features remain inspectable. A loss produces an outcome event exactly as a win does. The evaluation output keeps all forecasts.

`Object.freeze` prevents accidental mutation of the returned objects in the current JavaScript runtime. It does not write a file, database, or cryptographic audit log. The module's private object identities and second-settlement check disappear after restart. Duplicate prediction IDs across different objects/processes, persisted uniqueness, authenticated import/export, durable append operations, outcome corrections, backup, and tamper resistance are not implemented. The caller must append both the frozen prediction and the later outcome event to a future ledger; no persistence is implied by returning an event.

Brier score is the mean squared error between home-win probability and outcome. Log loss uses natural logarithms and clips only its logarithm input to `[1e-15, 1 - 1e-15]` to keep a 0/1 comparator miss finite; the exposed probabilities and Brier score remain unchanged. Reliability bins include `[0, 0.1)` through `[0.9, 1]`; empty bins have null means. Expected calibration error is the sample-weighted absolute gap between each populated bin's mean probability and observed home-win rate. Small bins are descriptive and noisy; no uncertainty interval is currently calculated.

## Real NBA integration remaining

1. Obtain an authorized provider key through the server-side setup flow, with no key in client code or chat. Preserve private access. No purchase or paid model call is authorized by this module.
2. Add a vetted ingestion adapter that produces the required lifecycle and evidence contract. The current display provider's normalized game date alone is insufficient: this module needs trustworthy explicit UTC tip-off, completion, schedule, and retained availability snapshots. Missing timestamps must cause an availability message, not an invented time. Keep stable provider IDs and reject duplicates.
3. Retain provenance and snapshots without backdating. Current downloads of historical finals can support later training, but do not reconstruct historical pregame knowledge. Any retrospective experiment must state its timestamp assumptions and limitations; a prospective saved history is stronger evidence.
4. Establish chronological train/validation/test periods and rolling evaluation across multiple periods. Select K/home advantage only within training/validation periods. Compare Elo with the home-win-rate baseline already implemented and other transparent baselines as appropriate. Report all samples, misses, sample counts, accuracy, Brier/log loss, and calibration with uncertainty. Keep the final test period untouched during selection.
5. If calibration is useful, fit it on a separate chronological validation segment and assess it on untouched later games. Never fit a calibration transform on the same outcomes used to advertise its results. Current code supplies measurements, not this fitting step.
6. Build a private, durable append-only ledger with unique IDs, trusted server timestamps, scheduled forecast jobs that refuse games at/after tip-off, snapshot hashes, access controls, and appendable settlement/correction events. Display frozen records and full outcomes in the app only after this is tested end to end.
7. Add injuries or matchup/player features only after a licensed, verified, timestamped feed exists. Assess feature value on later held-out games before describing them as model-used effects. Until then, show injury coverage as unavailable and keep it excluded from predictions.

Model artifact versioning, drift monitoring, persistence, a live route, operational traces, and UI integration remain explicit next steps. None is silently enabled by importing this file.
