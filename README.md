# Fanform · NBA Evidence Lab

A private, mobile-first sports-analysis prototype built for fans who want to understand the evidence behind a matchup. The design and implementation are original. The project is not affiliated with a league, team, sportsbook or OpenAI.

**Current state:** NBA only. A server-side BALLDONTLIE integration and a separate real-game desk are implemented. The provider account/key is not yet configured, so real connectivity is unverified. Learning fixtures and scenario percentages remain synthetic. No current injuries, paid subscriptions, model API calls or validated predictions exist. This is not the earlier stock website.

## Try the complete working flow

1. Select Boston/New York, Lakers/Warriors or Toronto/Miami. Search by a sample team name or ticker-like team code; save matchups locally.
2. Compare the sample team metrics and inspect the context.
3. Move the hypothetical absence and rest sliders. The result comes from a transparent deterministic sensitivity formula, not a trained outcome predictor.
4. Ask the evidence assistant about pace, the matchup, sources or the scenario. It returns cited approved passages and exact calculations. Ask who is injured today: it abstains because no current report is connected.
5. Inspect the retrieved passages and the engine details. No browser questions leave the page.

## Run locally

Requires Node.js 20+. The only development dependency is pinned esbuild; the deployed Worker has no external runtime dependencies. Keep all credentials server-side.

```sh
npm ci
npm test
npm run eval
npm run check
npm run build
```

For full local API preview, npm run dev serves the application without credentials on port 4173. In the managed Sites environment use its preview daemon instead of starting another server. A plain static server can show learning fixtures but cannot serve real-data APIs. The build embeds the preserved assets into one Worker module.

## What is actually AI?

The website runs a small **supervised multinomial Naive Bayes intent classifier** and **BM25 lexical retrieval** locally. It uses an approved evidence corpus, explicit routing/abstention rules, deterministic numerical tools and structured cited answers. Answers are extractive, assembled from evidence and templates. The classifier is trained on a tiny hand-authored teaching dataset; its performance is not a production-quality claim.

**This is not deployed generative RAG.** The optional `server/rag.mjs` implements dependency-injected chunking, vector retrieval, a model boundary, tools, budgets and output checks. Its embedding/generation adapters are tested with mocks. It has no default provider, no key, no network client, a disabled-by-default private API route and no end-to-end live-model verification. A real embedding model and generator require separate setup, provider/licence checks and bounded server-side deployment.

See [the AI concept map](docs/ai-concepts.md) for the meaning, implementation location, test method and status of each concept, and [the architecture](docs/architecture.md) for the upgrade path and interview-friendly explanation.

## Project structure

```text
dist/
  index.html      Accessible page structure and metadata
  styles.css      Responsive visual system; no third-party fonts
  app.js          Explicit UI state, rendering and browser events
  engine.js       Intent model, retrieval, calculators, guarded answers and traces
  evidence.js     Approved source register and synthetic NBA fixture pack
server/
  rag.mjs         Optional server pipeline; not imported by the hosted browser app
tests/
  engine.test.mjs Local engine correctness/safety tests
  rag.test.mjs    Pure pipeline and mocked adapter tests
  eval.mjs        Repeatable offline evaluation harness
docs/
  ai-concepts.md  What each concept means, how it works, how to test it, current state
  architecture.md Architecture, threat boundaries and future integrations
  research.md    Competitor insights, verified data options and cost tradeoffs
  qa.md          Actual checks and verification limits
.openai/hosting.json  Private Sites deployment identity and static output path
```

## Data and prediction boundaries

Real NBA team names identify examples only. Original text badges replace official logos. NBA glossary links support definitions; they are not a licensed live feed. Sample matches do not imply an actual schedule. The absence control is not a real injury status and does not estimate a named player's impact.

BALLDONTLIE NBA ALL-STAR is the promising US$9.99/month starting feed for stats and injuries. Its published terms permit public display and AI processing subject to third-party rights, but no account or subscription was created for this prototype. Endpoint coverage and freshness must be tested. The provider's higher-tier win-probability endpoint supplies completed-game history; it is not a pregame model. See the dated research and official links in `docs/research.md`.

A future real prediction model must use timestamped pregame inputs, chronological holdouts, baseline comparisons, Brier score/log loss and calibration reporting. A language model should explain calculated outputs rather than invent a probability. Missing injury data must remain unknown.

## Security and privacy

- No keys, credentials, personal details, trackers or external scripts are bundled. Provider/model adapters receive secrets only at runtime; builds never read keys.
- Questions are handled in browser memory; local storage contains only saved sample matchup IDs.
- Dynamic UI text uses `textContent`, never model/user-controlled HTML.
- Source links come from a reviewed register; new-tab links use `noopener noreferrer`.
- A restrictive HTML Content Security Policy blocks external scripts, frames and network calls. A future production backend also needs response headers, authentication where applicable, rate limits and provider budgets.
- Query/document limits, source scoping, injection heuristics and abstention reduce specific failure modes. They are not a guarantee that every adversarial input is detected.
- Optional RAG validation checks bounded structure, citations and numerical evidence. It cannot prove arbitrary natural-language entailment or medical/injury facts.
- The Site is owner-private. `robots.txt` is only crawler guidance, not access control. Do not change sharing as part of source deployment.

Before publishing a real-data version, verify hosting configuration, data permissions, actual API schemas and freshness, server-side secret handling, abuse limits, accessibility, and the user's outside-project requirements. No employment clearance or vulnerability-free guarantee is implied.

## GitHub preparation

The project has no third-party runtime dependencies or copied competitor assets. `.gitignore` excludes environment files, key files and generated archives. Before any repository publication, review the exact files/history and any future data/provider licences; do not commit real `.env` files or tokens. No GitHub repository was created or published by this task. Choose a code licence intentionally before a public release.

## Real data and model setup

See [model and billing setup](docs/model-setup.md). Set BALLDONTLIE_API_KEY only as a hosted secret after the free account exists; teams/players/games are free, injuries and player performance stats are not. No trial or paid subscription was selected. The real-data panel calls only same-origin private APIs and never falls back to a synthetic score.

The NBA adapter normalizes provider data with bounded fetches, an in-memory shared five/minute allowance, caching and safe errors. The live-evidence module constructs game evidence and extractive answers. The application module serves the preserved UI and API routes. Real HTTP model adapters are verified with mocks only. AI_API_ENABLED and AI_SPENDING_APPROVED both default off; browser requests cannot enable them. Provider billing controls and a durable shared spending guard remain prerequisites for a broader launch.

A source record fetched from the NBA provider is real data, but is not proof of a working language model. A real-model RAG claim requires successful embedding, retrieval, generation, citation validation and real-service evaluations, not just keys in configuration.

The [forecasting foundation](docs/forecasting.md) describes Elo, pregame snapshots, outcome scoring and leakage-free evaluation. It has synthetic tests only; no 60-70% daily accuracy, calibrated win probability or betting profitability has been established. Durable prediction storage and a real historical training dataset remain to connect.
