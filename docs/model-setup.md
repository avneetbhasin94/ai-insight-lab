# Optional model and embedding setup

Verified against official OpenAI documentation on **16 November 2026**. This is an implementation and setup guide, not evidence of a live model connection. No account, key, billing arrangement, paid request or subscription was created by this work.

## What exists

[`server/model-adapters.mjs`](../server/model-adapters.mjs) implements a fetch-based OpenAI embedding adapter and a structured generator matching [`server/rag.mjs`](../server/rag.mjs). They are **implemented and tested with HTTP mocks only**. No real embeddings, semantic-retrieval quality, provider compliance or end-to-end generated answer has been verified. `status.state: 'configured'` means the required configuration exists; `liveVerified` remains `false` deliberately.

Importing the module or calling `createModelAdapters()` makes no request. By default `embed` and `generate` are undefined, so the pipeline reports unavailable. Enabling requires all of:

- The exact boolean `enabled: true`, separately from possession of a key. A string such as `'true'` does not authorize the adapter.
- `apiKey`, obtained from a server runtime secret named `OPENAI_API_KEY`.
- Explicit `embeddingModel` and `generationModel`, supplied from `OPENAI_EMBEDDING_MODEL` and `OPENAI_GENERATION_MODEL`. There is no automatic or fallback model.
- Separate user authorization for real usage under a concrete budget, plus server spending controls. Setting a flag in code does not establish consent.

The hosting entry point must interpret `AI_API_ENABLED === 'true'` server-side and fail closed when it is absent. It must never accept these settings, a key, a model ID or source-rights flags from the browser. This adapter performs no environment lookup itself. Keep the adapter/pipeline instance alive across requests if using its local call and concurrency guards; recreating it resets their counts.

## Where the concepts become real

| Concept | Implemented location | What the implementation does | Evidence and remaining gap |
| --- | --- | --- | --- |
| Embeddings | `createModelAdapters().embed` | Sends a bounded text batch to the fixed official `/v1/embeddings` endpoint; requests float vectors; restores response index order; validates count, dimensions and finite nonzero values. | HTTP contract tests work. Real encoder vectors and semantic quality are unverified. |
| Vector retrieval | `rag.mjs`: `chunkDocuments`, `cosineSimilarity`, `retrieveByVector` | Preserves source offsets and metadata, ranks validated vectors and retrieves a bounded set. | Vector mathematics works with fake vectors. A real encoder is still required for a semantic result. |
| RAG | `rag.mjs`: `createRagPipeline` plus both adapters | Retrieves source chunks and passes only retrieved evidence to generation, then validates its answer. | Full mock orchestration works. No real model run has occurred; sports-data connectivity alone does not make this path live. |
| Structured outputs | `model-adapters.mjs`: `providerSchema`, `generate` | Wraps the existing output union in an object root with `result.anyOf`, translates `const` to explicitly typed string enums, and requests strict JSON Schema. Removes `uniqueItems` at the provider boundary; the independent validator enforces uniqueness. | Mock request shape and parser tests pass. Real provider acceptance remains a release check. |
| Tool/function calling | `rag.mjs`: `calculate`; adapter `generate` | The model can return typed `tool_request` records. Code dispatches only approved arithmetic on retrieved fact IDs, once, then sends actual tool results for the final answer. | Mock round trip works. This is application-dispatched structured tool intent, not the provider's native `function_call` protocol. Native or hosted tool calls are rejected; none are executed. |
| Grounding and citations | `rag.mjs`: `validateAnswer` | Rejects unknown citations and quantities/units that differ from evidence facts or deterministic results. Requires fresh connected injury evidence for availability claims. | Runtime contract tests work. Citation validity does not prove prose entails the source; semantic review is still required. |
| Prompt and injection boundaries | Adapter `generate`; pipeline guards | Keeps trusted instructions separate from serialized untrusted question/evidence, gives the provider no external tools and retains pipeline injection heuristics. | Known attack patterns are tested; protection is incomplete and must be evaluated adversarially. No secret is included in the model input. |
| Observability | `extractUsage`, `onUsage`, adapter `status`; pipeline `trace` | Extracts token counts without question, evidence, key, provider error text or raw model response. Missing/invalid usage is `null`. | Mock token extraction and redaction work. No billing ledger or external telemetry service is installed. |
| Cost and latency controls | `getLimits`, `request`; pipeline cache/deadline | Bounds inputs, output tokens, returned bytes, calls, concurrency and duration; no automatic retries. | Mock limits/cancellation tests pass. Local guards are not a global dollar cap. |
| Evaluations | [`tests/model-adapters.test.mjs`](../tests/model-adapters.test.mjs), existing pipeline/browser evaluations | Repeats successful and failing mock HTTP contracts, including the complete arithmetic/citation path. | These tests do not measure model reasoning, retrieval recall or predictive quality. An authorized real-model evaluation is still planned. |
| Model selection | Explicit deployment configuration | Lets a deployment compare/pin permitted models without changing the pipeline; refuses missing model IDs. | No model comparison or account access has been verified. |
| Prediction calibration/backtesting | Separate future prediction workflow | No change from the existing synthetic scenario model. An LLM explanation is not a trained outcome predictor. | Planned; no accuracy, calibrated probability, betting edge or profit claim. |

OpenAI requires an object root for strict schemas and documents refusal/incomplete cases separately. The adapter parses those cases, returns fixed refusal text and leaves business-rule checks to `validateAnswer`. See [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). The request formats follow the official [embedding endpoint](https://developers.openai.com/api/reference/resources/embeddings/methods/create) and [Responses endpoint](https://developers.openai.com/api/reference/resources/responses/methods/create).

## Secure configuration and authorization

The relevant Sites guidance is [`identity-and-secrets.md`](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites/references/identity-and-secrets.md). For hosted `OPENAI_API_KEY` setup it requires: “use the OpenAI Developers plugin's `openai-platform-api-key` skill and its required approval.” The plugin/key-creation capability was unavailable in this task. Enable the OpenAI Developers plugin to use that supported approval flow; no installation or key creation was attempted. Configure the resulting value through the native Sites runtime-secret tools. Never paste a key into chat, a browser field in this app, source control, `dist/`, `.openai/hosting.json`, logs or tests. Official guidance similarly requires [server-side credential storage](https://developers.openai.com/api/docs/guides/api-keys).

For a separately managed local/server environment, the owner can provision an approved project credential and inject it through its secret manager. Document names only, not values. Actual setup must preserve the existing private audience and explicitly authorize any account/billing change; creating a secret is not permission to spend.

Conceptual server wiring, **after authorization and spending controls**, looks like this:

```js
import { createModelAdapters } from './model-adapters.mjs';
import { createRagPipeline } from './rag.mjs';

// env is the hosting runtime's server-only binding, never a browser object.
const adapters = createModelAdapters({
  enabled: env.AI_API_ENABLED === 'true',
  apiKey: env.OPENAI_API_KEY,
  embeddingModel: env.OPENAI_EMBEDDING_MODEL,
  generationModel: env.OPENAI_GENERATION_MODEL,
  onUsage: event => recordTokenCountsOnly(event),
});
const rag = createRagPipeline({
  embed: adapters.embed,
  generate: adapters.generate,
  modelId: 'approved-generator-v1',
  embeddingId: 'approved-encoder-v1',
  allowedSourceHosts: ['approved-provider.example'],
});
// Load approved documents from server ingestion, never from client assertions.
// A real rag.run(...) may spend API credits; do not execute without authorization.
```

The placeholder usage recorder and approved-provider configuration above are setup instructions, not installed infrastructure. Secrets are sent only in the Authorization header to the constant `https://api.openai.com/v1` origin; redirects are rejected. There is no configurable base URL, credential in a query string, SDK retry or fallback provider.

## Budget before enabling

Current local defaults are 49 embedding texts, 4,000 characters per text, 60,000 embedding characters total, 24,000 generation-input characters, 1,200 output tokens per generation call, 8,000 returned answer characters, a 4 MB HTTP response, a 10-second deadline, two concurrent calls and **six lifetime calls per adapter instance**. Absolute bounds restrict overrides. Pipeline defaults can be stricter. The requested output cap includes provider reasoning tokens; it is not a visible-answer length promise. See the [Responses reference](https://developers.openai.com/api/reference/resources/responses/methods/create).

These are technical guardrails, not an enforced account budget. Character limits are not exact token accounting. Instances can restart or scale, and cancellations/timeouts may still incur usage remotely. An abort-ignoring operation retains its local concurrency slot until it settles, and failed calls still consume the local call count. Usage callbacks report observed counts after a response; they cannot authorize or cap an in-flight charge.

Before allowing chargeable requests, implement an atomic shared spending ledger that reserves the worst-case approved cost for embeddings and maximum generation before each call, refuses when accounting is unavailable or the cap is reached, and reconciles usage afterward. Retain reservations for uncertain outcomes; do not retry automatically. Include both potential generation rounds, prompt/schema overhead and reasoning/output tokens. Add authenticated global rate limits and a tested kill switch. Where available, set an actually enforced provider **hard spend limit**, then test rejection; spend alerts are different and may allow continued traffic. [Official rate/spend-limit guidance](https://developers.openai.com/api/docs/guides/rate-limits).

Planning examples only, verified 16 November 2026; standard text rates per **1 million tokens**, before any applicable taxes or other services:

| Candidate | Input | Output | Reason to evaluate |
| --- | --- | --- | --- |
| `text-embedding-3-small` | $0.02 | Not applicable | Small embedding option; [official model pricing](https://developers.openai.com/api/docs/models/text-embedding-3-small). |
| `gpt-6-luna` | $0.10 | $0.50 | Compact generation candidate with documented Responses/structured-output support; [official model page](https://developers.openai.com/api/docs/models/gpt-6-luna). |

No candidate above is selected automatically or confirmed accessible to this account. Recheck prices and access before deployment. Compute an estimate as `(embedding input tokens × embedding input rate + generation input tokens × input rate + generation output tokens × output rate) / 1,000,000`, summing all calls. Budget conservatively without assuming cache savings or free credits. Runtime setup must supply the actual rates and a concrete authorized cap; these examples are not a cost guarantee.

API access is organization/project based and uses API credentials; a ChatGPT conversation is not a server credential. Current official guidance offers an API-credit activation path for eligible paid Pro/Business owners linked to an API organization; eligibility, activation, remaining credit and model access are unverified here. Do not assume a ChatGPT plan pays this app's API usage. See [API credits for ChatGPT subscribers](https://developers.openai.com/api/docs/guides/chatgpt-api-credits).

## Reproducible checks without paid usage

From the project root:

```sh
node --check server/model-adapters.mjs
node --test tests/model-adapters.test.mjs
node --test tests/rag.test.mjs
node --test --test-name-pattern 'mock-only:.*calculation' tests/model-adapters.test.mjs
```

Every adapter test is labelled `mock-only`, supplies fake credentials to a fake HTTP function and never invokes the real provider. The suite inspects request schemas, fixed-origin routing, authorization gating, secret/error redaction, reordered/malformed vectors, response byte limits, output limits, unknown usage, no retries, deadlines, cancellation, local budgets and a complete mock calculation/citation round trip. Run existing browser evaluations separately; they concern the local engine, not this provider.

## Acceptance steps for a genuine NBA RAG result

1. Connect an authorized NBA source and ingest dated server-controlled records with source IDs, URLs, coverage, reviewable display/AI rights and typed numerical facts. A free feed may lack player stats or injuries; missing coverage stays unavailable. Source flags record review and do not grant a licence.
2. Obtain the necessary secure credentials and explicit authorization for a capped provider test. Verify actual account access, rates and effective spending controls without exposing secret values.
3. Embed approved chunks **and the held-out query with the real chosen encoder**, run the existing cosine retrieval and inspect retrieved chunk IDs, scores and source versions. Semantic quality must be measured; vectors alone do not prove relevant retrieval.
4. Run the **real structured generator** with the retrieved evidence. Exercise a real calculation request when useful; inspect refusal/incomplete responses and pass the final answer through independent schema, citation, freshness and exact-number checks. Verify the UI receives that validated server result and correctly labels connected versus synthetic evidence.
5. Run a versioned held-out evaluation: retrieval recall at k, answerability/refusal quality, citation correctness and human-reviewed entailment, numerical mismatches, injection cases, latency and actual usage/cost. Include absent/stale injury coverage and unsupported prediction requests. Save model, encoder, prompt, corpus and dataset versions with safe traces; compare to the current extractive baseline.
6. Only after those observations report a real end-to-end model-backed RAG result, with its date, data limitations and measured failures. Continue calling fixtures synthetic and forecasts unvalidated. Keep private hosting access unchanged.

RAG does not universally require vector search: retrieval can be lexical. This project specifically implements the vector-based path requested for learning, and it will only be described as a verified live path after the real retrieval-to-generation chain above succeeds. Connecting a sports API alone satisfies neither the embedding/model setup nor that acceptance test. Agents, MCP and a vector database are not required to make this small bounded path work; adding them would not remove these evidence gaps.
