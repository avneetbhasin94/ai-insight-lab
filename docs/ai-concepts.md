# FANFORM AI concepts and interview guide

## Server integration update — 16 November 2026

The current version adds a server-backed real-game desk. The BALLDONTLIE HTTP adapter, game-evidence retrieval, model HTTP adapters and private API routes are implemented and mock-tested; no provider account/key or real model call is yet verified. The local learning assistant described below remains a separate synthetic-data path. The embedding/generation route defaults disabled. See [model setup](model-setup.md), [forecasting](forecasting.md), server/application.mjs, server/nba-provider.mjs, server/live-evidence.mjs and server/model-adapters.mjs for the new boundaries. A key being present does not establish genuine RAG or forecast accuracy.


**Scope: a private, NBA-only prototype.** The working browser experience is a small applied-ML and evidence-retrieval system. It classifies a question, retrieves approved local evidence, runs deterministic calculations when needed, and renders a cited extractive explanation. It does **not** call an external language model. No generative RAG, live sports feed or current injury feed is connected. The optional server RAG boundary is exercised with scripted fake adapters only.

Three fictional matchup profiles—BOS–NYK, LAL–GSW and TOR–MIA—are created on **16 November 2026**. Their statistics, baseline percentages and absence penalties are invented. A date on a synthetic fixture means “created on,” never “live game data fetched on.” The [NBA Stats glossary](https://www.nba.com/stats/help/glossary) is an official reference for short metric definitions, verified on that date; linking it does not grant a statistics feed or a redistribution licence.

## Explain the architecture in an interview

“I built a basketball analysis lab that makes its evidence and limitations visible. A tiny supervised classifier recognizes the kind of question. A lexical retriever finds approved, sport- and matchup-scoped records. Real arithmetic runs in code rather than generated prose. Every supported answer identifies its evidence, and requests for current injuries or unsupported statistics abstain. I wrote held-out and adversarial evaluations. I also implemented a separate, mock-tested boundary for a future language-model service, but I have not connected or verified a real model.”

```text
Working private browser path — no external inference
Question + selected NBA matchup + explicit scenario sliders
  → size/type checks and deterministic safety/availability/scope guards
  → trained Naive Bayes intent classification
  → approved local evidence + BM25 lexical ranking
  → fixture/stat calculation OR extractive explanation
  → typed answer + source IDs + dates + measured local trace
  → UI text rendering

Separate optional server boundary — not connected to the UI
Administrator-approved dated documents + rights metadata
  → chunking → injected embedding adapter → cosine retrieval
  → injected generation adapter + constrained calculation tools
  → independent output/source/numerical validator
  → bounded memory cache + trace + availability/timeout response
Real embedding/generation adapters: not connected; tests use fakes.
```

The browser and server paths are deliberately described separately because a tested orchestration interface does not establish that retrieval and generation work with a real model. The default server response is unavailable when adapters are missing. There is no language-model key in the browser bundle.

## Concept inventory

“Working” means executable code with relevant tests. “Simulated” means an illustrative input/output or scripted fake dependency. “Planned” means no verified implementation with real data or a real provider. A row can have distinct statuses for a working boundary and an unconnected production dependency.

| AI concept | Meaning in plain language | Where and how implemented | How to test or evaluate | Status |
|---|---|---|---|---|
| Supervised intent classification | Learn which kind of question a user is asking from labelled examples. | `dist/engine.js`: `INTENT_TRAINING`, `trainNaiveBayes`, `classifyIntent`; a multinomial Naive Bayes model is trained locally from 48 hand-authored examples in six intent classes. Its label supplies retrieval-ranking hints. Safety and data-availability rules take precedence. | `tests/engine.test.mjs` classifier cases; `tests/eval.mjs` reports accuracy on separate prompts. Inspect mistakes as new real questions arrive. | **Working**, small educational classifier. It predicts intent, not game outcomes. |
| Tokenization and normalization | Turn text into comparable words and normalize aliases. | `tokenize` lowercases, normalizes Unicode, removes common words and maps terms such as BOS/Boston and eFG/effective. Explicit NBA team aliases also enforce matchup scope. | Alias, unknown-token, nickname/city and cross-matchup tests. | **Working**; English and a limited alias list, with no multilingual claim. |
| Lexical retrieval / BM25 | Rank evidence by informative matching words and document length. | `retrieveEvidence` indexes the approved bundled corpus, applies sport/matchup scope, scores with BM25, and adds a small intent hint. A real query overlap is required; hints alone cannot create evidence. | Held-out expected-document hit-at-3; irrelevant text returns no documents; foreign-team aliases return no documents. | **Working** local retrieval. No semantic-search claim. |
| Evidence corpus and chunking | Keep source material in reviewable pieces with identities. | `dist/evidence.js` has small hand-authored records. Browser records are already short; no automatic chunker is needed. `server/rag.mjs` provides bounded character chunks with overlap for future documents. | Corpus immutability/source tests; server chunk-size and overlap tests. | **Working** manual browser records and pure server chunker; production ingestion **planned**. |
| Embeddings | Represent semantic meaning as vectors so differently worded text can match. | Browser does not use embeddings. The optional server accepts an injected embedding adapter and implements cosine similarity and top-k retrieval. | Pure vector math plus scripted embedding-adapter cases in `tests/rag.test.mjs`. Add real-provider retrieval benchmarks before claiming semantic quality. | Vector math/interface **working**; embeddings in tests **simulated**; real embeddings **planned**. |
| Retrieval augmentation | Supply retrieved evidence to an answerer instead of relying only on model memory. | Browser extracts approved text and uses deterministic templates. Server passes retrieved chunks separately to its injected generator. | Expected evidence IDs, exact extractive/template answers, and server mock evidence-flow tests. | Browser extractive augmentation **working**. Full generative RAG with a real model **not connected or verified**. |
| LLM adapter and orchestration | Isolate a model service behind a replaceable interface. | `createRagPipeline` accepts `embed` and `generate` dependencies, model/version identifiers and limits. Real HTTP adapters and a disabled private route are supplied; no actual key or live inference is configured or verified. | Default unavailable response; scripted adapter success/failure/timeout tests. | Boundary **mock-tested**. External-model inference and production RAG **planned**. |
| Source provenance | Show where an answer’s evidence came from. | `SOURCE_REGISTRY`, stable source/document IDs, kind and date fields; answer records preserve evidence and citations. Official definitions remain distinct from synthetic fixtures and the availability register. | Citation identity, immutable kind/date/sport/matchup checks; changed metadata and invented citations fail validation. | **Working**. Source identity does not prove that the source is correct, licensed for every use, or semantically sufficient for a free-form claim. |
| Deterministic numerical tools | Let code perform arithmetic rather than asking a model to invent numbers. | `calculateScenario`, `calculateEffectiveFieldGoal`, and `metricComparison` compute exact outputs. Optional server allows only identified retrieved facts through `difference`, `mean`, and `ratePercent`. | Exact expected values, invalid-input tests, bounds, selected-fixture baselines and metric-difference regressions. | **Working** arithmetic; sports forecasting coefficients are **simulated**. |
| Structured outputs and validation | Return predictable fields that the interface can safely interpret. | Browser returns `status`, `answer`, `citations`, `evidence`, `metrics`, measured latency, mode and reason. `validateAnswerRecord` checks schema/source metadata and reconstructs supported template/extractive output. Server has a JSON Schema plus an independent validator. | Mutate citation IDs/dates/kinds, evidence matchup, baseline or answer text; tests reject changes. Server mocks test malformed output, unsupported citations and numerical mismatches. | **Working** local contract; model-produced structure **mock-tested**. This is not a general truth detector. |
| Tool use | Allow a model to request a narrowly scoped calculation. | Browser calls code directly. Server supports a constrained calculation tool round with bounded generator calls and source-identified numerical facts. | Tool allowlist, fact/source identity, exact value/unit and maximum-round cases. | Browser direct tools **working**; model-selected calls **simulated** with fakes. |
| Prompt design | Separate instructions, user questions and evidence. | Browser does not use an LLM prompt. Server keeps a fixed system instruction, question, evidence, schema and tool interface as separate arguments. | Inspect the scripted generator inputs; ensure source text is never promoted to system instructions. | Server prompt boundary **mock-tested**; provider behaviour **planned**. |
| Prompt-injection handling | Treat instructions embedded in user/source text as untrusted data. | Browser refuses known override/secret/executable patterns and accepts only bundled, frozen, registered records. Server validates source metadata and rejects known instruction patterns before generation. Citation links use approved HTTPS hosts. | User injection, malicious source text/title, unknown source and executable-payload cases. Expand with adversarial phrasing before opening ingestion. | **Working** bounded heuristics, not a complete security guarantee. |
| Abstention and availability | Say “insufficient evidence” instead of filling a gap. | Current injuries, scores and schedules have no connected feed. Unknown statistics, players and other matchups abstain. A prior hypothetical turn does not change the next current-injury request. Server injury handling requires connected, sufficiently recent, coverage-qualified documents. | Latest-injury, live-score, unknown-stat, sport/matchup and multi-turn regression tests; mock freshness cases. | **Working** local abstention. Actual reliable injury coverage **not connected**. |
| User safety | Keep fan education separate from a personal wagering plan. | Known staking, bankroll, parlay and guaranteed-profit requests are refused. The probability demonstration remains available with its synthetic/unvalidated status. No wagers, payment flow or personal betting profile exists. | Staking refusals plus a supported probability-education control case. | **Working** bounded routing; no claim of exhaustive semantic detection. |
| Evaluation datasets | Test questions whose expected behaviour is recorded in advance. | `EVAL_CASES` is separate from `INTENT_TRAINING`; it records expected status, evidence IDs and selected numerical outputs. Later discovered regressions are explicitly included. | `npm run eval` prints machine-readable JSON and exits nonzero for critical status/source/evidence/numerical failures. | **Working**, small hand-authored fixture; not an independent benchmark. |
| Retrieval and classifier evaluation | Measure retrieval success and intent labels separately from answer safety. | Evaluation reports expected-document hit-at-3 and intent accuracy, with denominators. Critical answer checks also verify fixture identity and exact numbers. | Inspect per-case rows, not just the headline ratio. Add paraphrases, ambiguous questions and held-out user sessions. | **Working** local metrics. No generalization or forecast-performance claim. |
| Regression and adversarial testing | Preserve fixes and test how the system fails. | Unit tests cover nickname/city leakage, unsupported stats, metric comparisons, changed metadata, injection, malformed inputs and context-independent current-injury abstention. | `npm test`; add a regression whenever a new failure is discovered. | **Working** deterministic tests; no promise of vulnerability-free code. |
| Confidence versus uncertainty | Distinguish a classifier’s label score from uncertainty about a game. | `classification.confidence` is the tiny intent model’s normalized score. Synthetic matchup percentages are separately labelled invented/unvalidated. Neither is a calibrated real-world probability. | Verify output labels; inspect examples with unknown words and low confidence. | Intent scores **working**; outcome confidence/calibration **planned**. |
| Scenario / sensitivity analysis | Show how an assumption changes a result while keeping the arithmetic visible. | NBA baseline defaults to 58%; selected fixtures have their own invented baseline. Absence severity `a` and workload `f` are 0–1 sliders; `p = clamp(baseline − 10a − 5f, 5, 95)`. These penalties are not learned player effects. | BOS baseline 58, `a=.5`, `f=.4` gives 51; TOR baseline 48 with the same sliders gives 41. Bounds and invalid types are tested. | Interaction and math **working**; baselines/coefficients **simulated**. |
| Calibration and temporal backtesting | Compare earlier forecasts with later outcomes without seeing the future. | No real outcome model, historical split or calibrated probabilities exist. Future work needs licensed dated snapshots, training-only fitting, rolling temporal evaluation, and baselines such as home-team rate. | Plan Brier score/log loss, calibration plots, leakage checks, sample sizes and per-period results. Do not fit and evaluate on the same outcomes. | **Planned**. There are no forecast accuracy or profit results. |
| Observability | Record what the system did so failures can be diagnosed. | Browser measures latency and counts status/intent/evidence IDs, retaining at most 20 traces in memory. `getObservabilitySnapshot` reports real counts; no raw questions or personal identifiers are logged. Server traces status/counts/versions/latency without raw prompts/errors. | Trace-retention and no-raw-question tests; mock server trace cases. | **Working** local instrumentation. No fabricated production traffic, uptime or model-token metrics. |
| Cost and resource controls | Bound work and make spending intentional. | Browser uses no paid APIs, caps question length at 1,200 characters and retrieval at five records. Optional server bounds inputs, output, top-k, tool rounds, concurrency, deadline and cache entries. Missing adapters fail closed. | Boundary tests, deadline/concurrency mocks and local zero-external-call counters. | Local cost is **working at zero paid API calls**. Provider accounting, organization-wide dollar caps and production rate limiting **planned**. |
| Caching | Reuse an unchanged answer to reduce repeated work. | Browser has no answer cache. Server uses SHA-256 cache keys, bounded memory/TTL and document/version/limit invalidation. | Mock cache hit, expiry, source/version change and retention cases. | Server cache mechanics **mock-tested**; production/shared cache **planned**. |
| Model selection and versioning | Choose a model based on measured quality, speed and cost. | Browser identifies its fixed intent model and engine version. Server accepts embedding/model version IDs for reproducibility and cache invalidation. No real models have been compared. | Version change invalidation tests; later compare licensed-data groundedness, retrieval, latency and provider cost on the same held-out set. | Version IDs **working**; model comparison/routing **planned**. |
| Privacy and secrets | Limit retained information and keep credentials out of public code. | Browser evidence/questions require no login or personal profile; questions/traces remain in runtime memory. No external-model key is present or requested. Any future provider credential belongs in the server environment and must never enter `dist/`. | Inspect built files for secrets; verify no raw-query telemetry; review any future endpoint’s redaction and retention. | Current no-secret/no-account browser path **working**; production credential/retention controls require deployment review. |
| Freshness and data quality | State when data was created/fetched and whether its coverage is enough. | Every bundled document has a kind/date. Synthetic creation dates are kept conceptually separate from official-reference verification. No fetch timestamp is invented. Server boundary accepts dated metadata and freshness policies. | Immutable date/kind tests; default missing-feed response; stale/missing mock injury-source cases. | Static labels **working**; live freshness monitoring and injury feed **planned**. |

## Run and interpret the checks

```bash
npm test
npm run eval
```

The engine evaluation currently contains **31** questions. On the verified run, all 31 status, source/schema, expected-evidence and numerical checks passed; intent accuracy was **18/18**, and expected-document retrieval hit-at-3 was **17/17**. Those are reproducible checks on this small, known fixture. Some prompts exercise fixes discovered during development, so these results must not be presented as an untouched external test set, a guarantee on arbitrary user questions, or sports prediction accuracy. The engine unit suite has **21** tests; the separate server suite uses scripted fake embedding/generation adapters. The server suite has its own results and architecture notes in `docs/architecture.md`.

The answer validator checks a controlled record and, for supported browser routes, reconstructs the expected extractive/template answer and numeric fields. It cannot establish that an official page remains current, that the original editorial evidence is true, that a licence grants a proposed use, or that future model prose is entailed by an exact source span. Server citation/fact checks likewise establish bounded document identity and numeric consistency, not universal semantic correctness.

## Data and operational limitations

There is no current injury list to show. “Absence impact” is an explicit hypothetical severity slider, not a claim about any named player. Free-text questions do not set slider values; the calculation uses the supplied structured slider inputs. Changing a slider updates the deterministic scenario, not a learned forecast. No betting odds, value edge, staking advice, wagers or guaranteed results are supplied.

The classifier is trained from few English examples and the retriever matches words rather than meaning. Ambiguous names, unseen paraphrases, unsupported player questions and multilingual text can fail or abstain. The scope guard uses a reviewed team-alias list and conservative keyword rules; it is not a comprehensive natural-language parser. Pattern-based injection and staking detection can have false positives and false negatives. The fixed, reviewed local corpus substantially limits the attack surface but does not prove complete security.

For the optional server, cancellation can request that an adapter stop; it cannot forcibly stop a provider that ignores its abort signal. Timed-out work must keep its concurrency slot until it settles. Per-instance concurrency, TTL caching and call bounds are not organization-wide spending caps. Production requires authenticated server endpoints, approved data ingestion, verified display/AI-processing rights, provider-specific request/token accounting, key rotation, a real-model end-to-end test and monitoring before any connected-AI claim.

## Practical evolution

1. Confirm NBA display, caching, redistribution and AI-processing permissions for one affordable provider. Confirm injury coverage separately. Add server-only credentials only after authorization.
2. Normalize permitted API responses into dated records with source IDs, coverage, fetch status and clear stale/unavailable states. Preserve a separate synthetic demo mode.
3. Connect one server embedding/generation adapter behind the existing unavailable default. Test real source retrieval, model answers, refusals, costs and timeouts end to end; only then label that path connected RAG.
4. Expand the held-out question set with real fan questions and independent review. Track unsupported-claim errors, abstention, evidence sufficiency and alias/sport leakage as well as retrieval scores.
5. Train a simple outcome baseline on licensed historical data, use rolling temporal evaluation, report calibration and uncertainty, and compare with a transparent naive baseline. Keep language generation separate from probability calculation.

The most defensible interview story is the set of design decisions and verified boundaries: working local ML, retrieval and tools; explicit provenance and abstention; repeatable evaluation; and an honest, testable path to a real connected service.


## Code reading map

These GitHub-compatible links point to the implementation in this version. Function names remain the stable reference if later edits shift line numbers.

| Concept implementation | Source location |
| --- | --- |
| `tokenize` | [dist/engine.js:40](../dist/engine.js#L40) |
| `trainNaiveBayes` | [dist/engine.js:54](../dist/engine.js#L54) |
| `classifyIntent` | [dist/engine.js:65](../dist/engine.js#L65) |
| `isSafeEvidenceDocument` | [dist/engine.js:76](../dist/engine.js#L76) |
| `retrieveEvidence` | [dist/engine.js:98](../dist/engine.js#L98) |
| `calculateScenario` | [dist/engine.js:126](../dist/engine.js#L126) |
| `calculateEffectiveFieldGoal` | [dist/engine.js:145](../dist/engine.js#L145) |
| `getObservabilitySnapshot` | [dist/engine.js:151](../dist/engine.js#L151) |
| `getEvidenceAnswer` | [dist/engine.js:184](../dist/engine.js#L184) |
| `validateAnswerRecord` | [dist/engine.js:245](../dist/engine.js#L245) |
| `validateSource` | [server/rag.mjs:65](../server/rag.mjs#L65) |
| `chunkDocuments` | [server/rag.mjs:84](../server/rag.mjs#L84) |
| `cosineSimilarity` | [server/rag.mjs:122](../server/rag.mjs#L122) |
| `retrieveByVector` | [server/rag.mjs:134](../server/rag.mjs#L134) |
| `calculate` | [server/rag.mjs:141](../server/rag.mjs#L141) |
| `validateAnswer` | [server/rag.mjs:199](../server/rag.mjs#L199) |
| `createRagPipeline` | [server/rag.mjs:255](../server/rag.mjs#L255) |
| `renderScenario` | [dist/app.js:101](../dist/app.js#L101) |
| `askQuestion` | [dist/app.js:125](../dist/app.js#L125) |
