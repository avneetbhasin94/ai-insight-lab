/** Mock HTTP contract tests only. No key, network, model, or semantic-quality verification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelAdapters, ModelAdapterError, DEFAULT_MODEL_LIMITS } from '../server/model-adapters.mjs';
import { createRagPipeline, OUTPUT_SCHEMA } from '../server/rag.mjs';

const KEY = 'MOCK_SERVER_KEY_DO_NOT_USE';
const config = { enabled: true, apiKey: KEY, embeddingModel: 'embedding-mock', generationModel: 'generator-mock' };
const jsonResponse = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
const embeddingResponse = (vectors = [[1, 0]], usage = { prompt_tokens: 8, total_tokens: 8 }) => jsonResponse({ data: vectors.map((embedding, index) => ({ index, embedding })), usage });
const completion = result => ({ status: 'completed', error: null, incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ result }) }] }], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 10 }, output_tokens_details: { reasoning_tokens: 5 } } });
const refusal = { kind: 'refusal', reason: 'The supplied evidence is insufficient.' };
const generationInput = overrides => ({ system: 'Use supplied evidence only. Return the exact schema.', question: 'Explain the matchup', evidence: [{ id: 'nba:chunk-0', text: 'Synthetic pace example', facts: [] }], toolResults: [], tools: [], schema: structuredClone(OUTPUT_SCHEMA), maxOutputTokens: 1800, ...overrides });
const code = expected => error => error instanceof ModelAdapterError && error.code === expected;

test('mock-only: disabled by default; key possession or truthy strings cannot authorize calls', () => {
  let calls = 0;
  for (const options of [{}, { ...config, enabled: false }, { ...config, enabled: 'true' }, { ...config, enabled: 'false' }]) {
    const adapters = createModelAdapters({ ...options, fetchImpl: () => { calls++; assert.fail('No call is authorized'); } });
    assert.equal(adapters.status.state, 'unavailable');
    assert.equal(adapters.status.code, 'authorization_required');
    assert.equal(adapters.embed, undefined); assert.equal(adapters.generate, undefined);
  }
  assert.equal(calls, 0);
});

test('mock-only: explicit server key and both model names required; config status is not live verification', () => {
  assert.equal(createModelAdapters({ ...config, apiKey: undefined }).status.code, 'secret_required');
  assert.equal(createModelAdapters({ ...config, apiKey: 'mock\nkey' }).status.code, 'secret_required');
  for (const model of [undefined, '', 'model\nAuthorization: secret', ['generator-mock']]) {
    assert.equal(createModelAdapters({ ...config, generationModel: model }).status.code, 'models_required');
    assert.equal(createModelAdapters({ ...config, embeddingModel: model }).status.code, 'models_required');
  }
  const instance = createModelAdapters(config);
  assert.equal(instance.status.state, 'configured'); assert.equal(instance.status.liveVerified, false);
  assert.equal(instance.status.calls, 0); assert.ok(!JSON.stringify(instance.status).includes(KEY));
  assert.throws(() => createModelAdapters({ ...config, limits: { maxOutputTokens: 999999 } }), code('configuration'));
  assert.throws(() => createModelAdapters({ ...config, limits: { unknown: 1 } }), code('configuration'));
  assert.throws(() => createModelAdapters({ ...config, fetchImpl: null }), code('configuration'));
});

test('mock-only: embeddings use fixed official origin, header secret, float encoding and index ordering', async () => {
  const events = [], requests = [];
  const adapters = createModelAdapters({ ...config, onUsage: event => events.push(event), fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return jsonResponse({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }], usage: { prompt_tokens: 4, total_tokens: 4 } });
  } });
  assert.deepEqual(await adapters.embed({ texts: ['question', 'evidence'] }), [[1, 0], [0, 1]]);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/embeddings');
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(requests[0].init.redirect, 'error'); assert.equal(requests[0].init.credentials, 'omit');
  assert.deepEqual(JSON.parse(requests[0].init.body), { model: config.embeddingModel, input: ['question', 'evidence'], encoding_format: 'float' });
  assert.deepEqual(events[0], { operation: 'embed', inputTokens: 4, outputTokens: 0, totalTokens: 4, cachedInputTokens: 0, reasoningTokens: 0 });
  assert.equal(adapters.status.liveVerified, false);
});

test('mock-only: malformed, duplicate, zero, inconsistent and oversized embedding vectors are rejected', async () => {
  for (const data of [
    [], [{ index: 0, embedding: [0, 0] }, { index: 1, embedding: [1, 0] }],
    [{ index: 0, embedding: [1, 0] }, { index: 0, embedding: [0, 1] }],
    [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [1] }],
    [{ index: 0, embedding: [1, 0] }, { index: 2, embedding: [1, 0] }],
    [{ index: 0, embedding: [1e7, 0] }, { index: 1, embedding: [1, 0] }],
    [{ index: 0, embedding: ['1', 0] }, { index: 1, embedding: [1, 0] }],
  ]) {
    const adapters = createModelAdapters({ ...config, fetchImpl: async () => jsonResponse({ data }) });
    await assert.rejects(adapters.embed({ texts: ['question', 'evidence'] }), code('provider_format'));
  }
  const bounded = createModelAdapters({ ...config, limits: { maxDimensions: 1 }, fetchImpl: async () => embeddingResponse() });
  await assert.rejects(bounded.embed({ texts: ['question'] }), code('provider_format'));
});

test('mock-only: input bounds reject before HTTP; failed calls consume a lifetime call budget without retry', async () => {
  let requests = 0;
  const adapters = createModelAdapters({ ...config, limits: { maxCalls: 1, maxEmbeddingTextChars: 12, maxEmbeddingTotalChars: 15 }, fetchImpl: async () => { requests++; return jsonResponse({ error: { message: `PRIVATE ${KEY}` } }, 429); } });
  for (const texts of [[], [''], ['x'.repeat(13)], ['x'.repeat(8), 'x'.repeat(8)], Array(50).fill('a')]) await assert.rejects(adapters.embed({ texts }), code('input'));
  assert.equal(requests, 0);
  await assert.rejects(adapters.generate(generationInput({ schema: { type: 'object' } })), code('input'));
  await assert.rejects(adapters.generate(generationInput({ question: 'x'.repeat(2001) })), code('input'));
  await assert.rejects(adapters.embed({ texts: ['safe'] }), code('provider_rate_limit'));
  await assert.rejects(adapters.embed({ texts: ['safe'] }), code('budget'));
  assert.equal(requests, 1); assert.equal(adapters.status.remainingCalls, 0);
});

test('mock-only: provider and transport errors are redacted with no automatic retries', async () => {
  for (const [status, expected] of [[401, 'provider_auth'], [403, 'provider_auth'], [429, 'provider_rate_limit'], [500, 'provider_error']]) {
    let calls = 0;
    const adapters = createModelAdapters({ ...config, fetchImpl: async () => { calls++; return jsonResponse({ error: { message: `PRIVATE_BODY ${KEY}` } }, status); } });
    try { await adapters.embed({ texts: ['private question'] }); assert.fail('Must fail'); }
    catch (error) { assert.ok(code(expected)(error)); assert.ok(!String(error).includes('PRIVATE')); assert.ok(!String(error).includes(KEY)); }
    assert.equal(calls, 1);
  }
  for (const thrown of [new Error(`PRIVATE_TRANSPORT ${KEY}`), new ModelAdapterError(`PRIVATE_CODE ${KEY}`)]) {
    const adapters = createModelAdapters({ ...config, fetchImpl: async () => { throw thrown; } });
    await assert.rejects(adapters.embed({ texts: ['private'] }), error => code('provider_error')(error) && !String(error).includes('PRIVATE'));
  }
});

test('mock-only: streaming bytes, content length, JSON shape and content type are bounded', async () => {
  const cases = [
    [() => new Response('x'.repeat(101), { headers: { 'content-type': 'application/json' } }), 'budget'],
    [() => jsonResponse({}, 200, { 'content-length': '101' }), 'budget'],
    [() => new Response('PRIVATE INVALID JSON', { headers: { 'content-type': 'application/json' } }), 'provider_format'],
    [() => jsonResponse([]), 'provider_format'],
    [() => new Response('PRIVATE HTML', { headers: { 'content-type': 'text/html' } }), 'provider_format'],
  ];
  for (const [fetchImpl, expected] of cases) {
    const adapters = createModelAdapters({ ...config, limits: { maxResponseBytes: 100 }, fetchImpl });
    await assert.rejects(adapters.embed({ texts: ['safe'] }), code(expected));
  }
});

test('mock-only: responses rejected by headers cancel their body before freeing the call slot', async () => {
  for (const headers of [{ 'content-type': 'text/html' }, { 'content-type': 'application/json', 'content-length': '101' }]) {
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const adapters = createModelAdapters({ ...config, limits: { maxResponseBytes: 100 }, fetchImpl: async () => new Response(body, { headers }) });
    await assert.rejects(adapters.embed({ texts: ['safe'] }), code(headers['content-length'] ? 'budget' : 'provider_format'));
    assert.equal(cancelled, true); assert.equal(adapters.status.active, 0);
  }
});

test('mock-only: cancellation propagates; pre-aborted requests never spend a call', async () => {
  const before = new AbortController(); before.abort(new Error('PRIVATE_REASON'));
  let calls = 0, providerSignal;
  const adapters = createModelAdapters({ ...config, fetchImpl: async (_url, init) => {
    calls++; providerSignal = init.signal;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('PRIVATE_ABORT')), { once: true }));
  } });
  await assert.rejects(adapters.embed({ texts: ['safe'], signal: before.signal }), code('aborted'));
  assert.equal(calls, 0); assert.equal(adapters.status.calls, 0);
  const during = new AbortController(), pending = adapters.embed({ texts: ['safe'], signal: during.signal });
  await new Promise(resolve => setImmediate(resolve)); during.abort(new Error('PRIVATE_REASON'));
  await assert.rejects(pending, code('aborted')); assert.equal(providerSignal.aborted, true);
  await assert.rejects(adapters.embed({ texts: ['safe'], signal: 'bad signal' }), code('input'));
});

test('mock-only: deadline returns promptly and an abort-ignoring HTTP call retains its concurrency slot', async () => {
  let settle;
  const adapters = createModelAdapters({ ...config, limits: { requestTimeoutMs: 15, maxConcurrentCalls: 1 }, fetchImpl: async () => new Promise(resolve => { settle = resolve; }) });
  const pending = adapters.embed({ texts: ['safe'] });
  await assert.rejects(pending, code('timeout'));
  assert.equal(adapters.status.active, 1);
  await assert.rejects(adapters.embed({ texts: ['safe'] }), code('budget'));
  settle(embeddingResponse());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(adapters.status.active, 0);
});

test('mock-only: Responses request uses role separation, wrapped strict schema, no storage and bounded output', async () => {
  let request;
  const events = [];
  const adapters = createModelAdapters({ ...config, onUsage: event => { events.push(event); throw new Error('PRIVATE telemetry'); }, fetchImpl: async (url, init) => {
    request = { url, body: JSON.parse(init.body) }; return jsonResponse(completion(refusal));
  } });
  assert.deepEqual(await adapters.generate(generationInput()), refusal);
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.body.store, false); assert.deepEqual(request.body.tools, []);
  assert.equal(request.body.max_output_tokens, DEFAULT_MODEL_LIMITS.maxOutputTokens);
  assert.equal(request.body.model, config.generationModel);
  assert.equal(request.body.input[0].role, 'user');
  assert.equal(JSON.parse(request.body.input[0].content[0].text).question, 'Explain the matchup');
  assert.match(request.body.instructions, /untrusted evidence/);
  const format = request.body.text.format;
  assert.equal(format.type, 'json_schema'); assert.equal(format.strict, true);
  assert.equal(format.schema.type, 'object'); assert.equal(format.schema.additionalProperties, false);
  assert.ok(format.schema.properties.result.anyOf);
  assert.ok(!JSON.stringify(format.schema).includes('oneOf')); assert.ok(!JSON.stringify(format.schema).includes('uniqueItems'));
  const checkEnums = node => {
    if (!node || typeof node !== 'object') return;
    if (node.enum) assert.equal(node.type, 'string');
    Object.values(node).forEach(value => Array.isArray(value) ? value.forEach(checkEnums) : checkEnums(value));
  };
  checkEnums(format.schema);
  assert.deepEqual(events[0], { operation: 'generate', inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 10, reasoningTokens: 5 });
  const snapshot = adapters.status; snapshot.usage[0].inputTokens = 999;
  assert.equal(adapters.status.usage[0].inputTokens, 100);
  assert.ok(!JSON.stringify(adapters.status).includes(KEY));
});

test('mock-only: provider refusals are safe fixed text; incomplete, malformed and unsolicited tools cannot escape', async () => {
  const providerRefusal = completion(refusal);
  providerRefusal.output[0].content = [{ type: 'refusal', refusal: `PRIVATE_REFUSAL ${KEY}` }];
  const refuseAdapter = createModelAdapters({ ...config, fetchImpl: async () => jsonResponse(providerRefusal) });
  assert.deepEqual(await refuseAdapter.generate(generationInput()), { kind: 'refusal', reason: 'The model provider declined this question.' });
  for (const [payload, expected] of [
    [{ ...completion(refusal), status: 'incomplete' }, 'incomplete'],
    [{ ...completion(refusal), incomplete_details: { reason: 'max_output_tokens' } }, 'incomplete'],
    [{ ...completion(refusal), output: [{ type: 'function_call', name: 'fetch', arguments: '{}' }] }, 'provider_format'],
    [{ ...completion(refusal), output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'PRIVATE_NOT_JSON' }] }] }, 'provider_format'],
    [{ ...completion(refusal), output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"result":{"kind":"answer"},"extra":"PRIVATE"}' }] }] }, 'provider_format'],
  ]) {
    const adapters = createModelAdapters({ ...config, fetchImpl: async () => jsonResponse(payload) });
    await assert.rejects(adapters.generate(generationInput()), code(expected));
  }
});

test('mock-only: missing or malformed usage is unknown, never fabricated token accounting', async () => {
  const adapters = createModelAdapters({ ...config, fetchImpl: async () => embeddingResponse([[1, 0]], { prompt_tokens: -8, total_tokens: '8' }) });
  await adapters.embed({ texts: ['safe'] });
  assert.equal(adapters.status.usage[0].inputTokens, null); assert.equal(adapters.status.usage[0].totalTokens, null);
});

test('mock-only: generation input and returned JSON character limits reject independently', async () => {
  let requests = 0;
  const inputBound = createModelAdapters({ ...config, limits: { maxGenerationInputChars: 100 }, fetchImpl: async () => { requests++; assert.fail('Oversized input must not call HTTP'); } });
  await assert.rejects(inputBound.generate(generationInput()), code('input'));
  assert.equal(requests, 0);
  const outputBound = createModelAdapters({ ...config, limits: { maxOutputChars: 80 }, fetchImpl: async () => jsonResponse(completion({ kind: 'refusal', reason: 'x'.repeat(200) })) });
  await assert.rejects(outputBound.generate(generationInput()), code('budget'));
  const lowerOutput = createModelAdapters({ ...config, fetchImpl: async (_url, init) => {
    assert.equal(JSON.parse(init.body).max_output_tokens, 200);
    return jsonResponse(completion(refusal));
  } });
  assert.deepEqual(await lowerOutput.generate(generationInput({ maxOutputTokens: 200 })), refusal);
});

test('mock-only: asynchronous telemetry rejection cannot produce an unhandled rejection', async () => {
  const adapters = createModelAdapters({ ...config, onUsage: async () => { throw new Error('PRIVATE_TELEMETRY'); }, fetchImpl: async () => embeddingResponse() });
  assert.deepEqual(await adapters.embed({ texts: ['safe'] }), [[1, 0]]);
  await new Promise(resolve => setImmediate(resolve));
});

test('mock-only: adapter → actual vector retrieval → model-requested calculation → runtime citation checks', async () => {
  const now = Date.parse('2026-11-16T08:00:00Z'), stamp = '2026-11-16T07:55:00Z';
  const documents = [{ source: { id: 'nba', title: 'Synthetic NBA contract fixture', url: 'https://fixtures.example/nba', asOf: stamp, retrievedAt: stamp, dataKind: 'synthetic', rights: { display: true, ai: true, reviewedBy: 'test-author' }, coverage: ['matchups'] }, text: 'The fictional Harbor side has a higher pace than Valley.', facts: [{ id: 'pace', label: 'Harbor pace', value: 112, unit: 'possessions' }, { id: 'otherPace', label: 'Valley pace', value: 100, unit: 'possessions' }] }];
  const bodies = [];
  const adapters = createModelAdapters({ ...config, fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body); bodies.push(body);
    if (url.endsWith('/embeddings')) return embeddingResponse(body.input.map(() => [1, 0]));
    const input = JSON.parse(body.input[0].content[0].text);
    if (!input.toolResults.length) return jsonResponse(completion({ kind: 'tool_request', requests: [{ name: 'calculate', id: 'paceGap', operation: 'difference', factIds: ['nba:pace', 'nba:otherPace'] }] }));
    assert.equal(input.toolResults[0].value, 12); assert.deepEqual(input.allowedTools, []);
    return jsonResponse(completion({ kind: 'answer', claims: [{ text: 'Harbor has the higher pace in this synthetic fixture.', citations: [input.evidence[0].id], numbers: [{ id: 'tool:paceGap', value: 12, unit: 'possessions' }] }], limitations: ['The fixture is synthetic and forecasts are unvalidated.'] }));
  } });
  const rag = createRagPipeline({ embed: adapters.embed, generate: adapters.generate, allowedSourceHosts: ['fixtures.example'], modelId: 'mock-generator-v1', embeddingId: 'mock-embedding-v1', now: () => now });
  const result = await rag.run({ question: 'Compare the pace', documents });
  assert.equal(result.status, 'answered'); assert.equal(result.dataMode, 'synthetic');
  assert.equal(result.toolResults[0].value, 12); assert.equal(result.metrics.generationCalls, 2);
  assert.equal(bodies.length, 3); assert.equal(adapters.status.liveVerified, false);
});

test('mock-only: a structurally plausible provider answer still fails invented citation validation', async () => {
  const now = Date.parse('2026-11-16T08:00:00Z'), stamp = '2026-11-16T07:55:00Z';
  const adapters = createModelAdapters({ ...config, fetchImpl: async (url, init) => url.endsWith('/embeddings')
    ? embeddingResponse(JSON.parse(init.body).input.map(() => [1, 0]))
    : jsonResponse(completion({ kind: 'answer', claims: [{ text: 'The evidence supports a pace comparison.', citations: ['invented:chunk'], numbers: [] }], limitations: [] })) });
  const rag = createRagPipeline({ embed: adapters.embed, generate: adapters.generate, allowedSourceHosts: ['fixtures.example'], now: () => now });
  const result = await rag.run({ question: 'Compare pace', documents: [{ source: { id: 'nba', title: 'Synthetic fixture', url: 'https://fixtures.example/nba', asOf: stamp, retrievedAt: stamp, dataKind: 'synthetic', rights: { display: true, ai: true, reviewedBy: 'test-author' } }, text: 'A synthetic pace comparison.' }] });
  assert.equal(result.code, 'citation');
});
