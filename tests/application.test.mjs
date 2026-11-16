/** HTTP integration uses synthetic schema fixtures and injected adapters only.
 * No fixture is a verified NBA result; no network, provider key or paid call runs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createApplication } from '../server/application.mjs';
import { createNbaProvider, NbaProviderError } from '../server/nba-provider.mjs';
import { createModelAdapters } from '../server/model-adapters.mjs';

const NOW = Date.parse('2026-11-16T12:00:00.000Z');
const DATE = '2026-11-16';
const STAMP = '2026-11-16T12:00:00.000Z';
const ORIGIN = 'https://private.example';
const SECRET = 'SYNTHETIC_TEST_SECRET';
const ENV = { BALLDONTLIE_API_KEY: SECRET, AI_API_ENABLED: 'true', AI_SPENDING_APPROVED: 'true', OPENAI_API_KEY: SECRET, OPENAI_EMBEDDING_MODEL: 'test-embedding', OPENAI_GENERATION_MODEL: 'test-generation' };
const request = (path, options) => new Request(`${ORIGIN}${path}`, options);
const post = (path, body, headers = {}) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const team = (id, abbreviation, name, fullName) => ({ id, abbreviation, name, fullName, city: 'Synthetic schema fixture' });
const result = () => ({
  data: [
    { id: 41, date: DATE, season: 2026, status: 'final', homeTeam: team(2, 'BOS', 'Celtics', 'Boston Celtics'), awayTeam: team(14, 'LAL', 'Lakers', 'Los Angeles Lakers'), homeScore: 115, awayScore: 105 },
    { id: 42, date: DATE, season: 2026, status: 'scheduled', homeTeam: team(10, 'GSW', 'Warriors', 'Golden State Warriors'), awayTeam: team(20, 'NYK', 'Knicks', 'New York Knicks'), homeScore: null, awayScore: null },
  ],
  provenance: { provider: 'BALLDONTLIE', dataMode: 'provider', fetchedAt: STAMP, cache: 'miss', providerUpdatedAt: null },
  pagination: { partial: false, nextCursor: null },
});
function fakeProvider(overrides = {}) {
  const calls = { games: [], teams: 0 };
  return { calls, getStatus: () => ({ provider: 'BALLDONTLIE', configured: true, state: 'ready', lastSuccessAt: null }),
    getGames: async input => { calls.games.push(input); return result(); },
    getTeams: async () => { calls.teams++; return { data: [] }; }, ...overrides };
}
const appFor = (provider, overrides = {}) => createApplication({ now: () => NOW, providerFactory: () => provider, ...overrides });
const question = (overrides = {}) => ({ date: DATE, question: 'What is the Celtics score?', ...overrides });

test('missing provider key returns 503 without network activity; status never exposes configuration secrets', async () => {
  let networkCalls = 0;
  const app = createApplication({ now: () => NOW, providerFactory: options => createNbaProvider({ ...options, fetchImpl: async () => { networkCalls++; assert.fail('No network permitted'); } }) });
  for (const req of [request(`/api/nba/games?date=${DATE}`), request('/api/nba/teams'), post('/api/nba/ask', question())]) {
    const response = await app.fetch(req);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'not_configured');
  }
  const status = await (await app.fetch(request('/api/nba/status'), { OPENAI_API_KEY: SECRET })).json();
  assert.equal(status.provider.configured, false);
  assert.equal(status.model.paidCallsEnabled, false);
  assert.equal(status.model.liveVerified, false);
  assert.equal(status.access, 'owner-private-site');
  assert.ok(!JSON.stringify(status).includes(SECRET));
  assert.equal(networkCalls, 0);
});

test('provider instances retain cache/quota state until the configured key changes', async () => {
  const created = [];
  const app = createApplication({ providerFactory: config => { created.push(config); return fakeProvider(); }, modelFactory: () => ({ status: { state: 'unavailable' } }), now: () => NOW });
  for (const key of [SECRET, SECRET, 'ANOTHER_TEST_SECRET']) await app.fetch(request('/api/nba/status'), { BALLDONTLIE_API_KEY: key });
  assert.equal(created.length, 2);
  assert.deepEqual(created.map(config => config.apiKey), [SECRET, 'ANOTHER_TEST_SECRET']);
});

test('GET games rejects extra/duplicate query parameters and unsafe team IDs before requesting games', async () => {
  const provider = fakeProvider(), app = appFor(provider);
  for (const query of [`date=${DATE}&extra=x`, `date=${DATE}&date=${DATE}`, `date=${DATE}&teamId=2&teamId=3`, `date=${DATE}&teamId=`, `date=${DATE}&teamId=0`, `date=${DATE}&teamId=-2`, `date=${DATE}&teamId=2.5`, `date=${DATE}&teamId=02`, `date=${DATE}&teamId=1000000000`]) {
    assert.equal((await app.fetch(request(`/api/nba/games?${query}`), ENV)).status, 400, query);
  }
  assert.equal(provider.calls.games.length, 0);
  const response = await app.fetch(request(`/api/nba/games?date=${DATE}&teamId=2`), ENV);
  assert.equal(response.status, 200);
  assert.deepEqual(provider.calls.games, [{ date: DATE, teamId: 2 }]);
  assert.equal((await app.fetch(request('/api/nba/teams?date=anything'), ENV)).status, 400);
  assert.equal(provider.calls.teams, 0);
});

test('invalid GET dates and POST date types fail before any upstream fetch', async () => {
  let calls = 0;
  const app = createApplication({ now: () => NOW, providerFactory: options => createNbaProvider({ ...options, fetchImpl: async () => { calls++; assert.fail('Invalid date must not reach upstream'); } }) });
  for (const date of ['', '2026-02-30', '11/16/2026', '2026-11-16T00:00:00Z', '1945-12-31', '2028-01-01']) {
    assert.equal((await app.fetch(request(`/api/nba/games?date=${encodeURIComponent(date)}`), ENV)).status, 400, date);
  }
  assert.equal((await app.fetch(request('/api/nba/games'), ENV)).status, 400);
  for (const date of [undefined, null, 20261116, [], {}, '2026-02-30']) {
    assert.equal((await app.fetch(post('/api/nba/ask', question({ date })), ENV)).status, 400, JSON.stringify(date));
  }
  assert.equal(calls, 0);
});

test('provider authentication, rate limits and unexpected errors have fixed redacted HTTP responses', async () => {
  for (const [problem, status, code] of [
    [new NbaProviderError('auth_failed_or_tier'), 502, 'auth_failed_or_tier'],
    [new NbaProviderError('rate_limited', { retryAfterMs: 1000 }), 429, 'rate_limited'],
    [new Error(SECRET), 502, 'upstream_unavailable'],
    [new TypeError(SECRET), 400, 'invalid_input'],
  ]) {
    const app = appFor(fakeProvider({ getGames: async () => { throw problem; } }));
    const response = await app.fetch(request(`/api/nba/games?date=${DATE}`), ENV);
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.ok(!JSON.stringify(body).includes(SECRET));
    assert.ok(!JSON.stringify(body).includes('stack'));
    if (status === 429) assert.equal(body.retryAfterMs, 1000);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('POST rejects malformed JSON, non-object bodies, unknown fields, question and game-ID coercion', async () => {
  const provider = fakeProvider(), app = appFor(provider);
  for (const body of [null, [], true, { ...question(), extra: true }, question({ question: '' }), question({ question: ' '.repeat(3) }), question({ question: 12 }), question({ question: 'x'.repeat(601) }), ...[0, -1, 1.5, '41', Number.MAX_SAFE_INTEGER + 1].map(gameId => question({ gameId }))]) {
    assert.equal((await app.fetch(post('/api/nba/ask', body), ENV)).status, 400, JSON.stringify(body));
  }
  for (const [body, type] of [['{', 'application/json'], ['{}', 'text/plain']]) {
    assert.equal((await app.fetch(request('/api/nba/ask', { method: 'POST', headers: { 'Content-Type': type }, body }), ENV)).status, 400);
  }
  assert.equal(provider.calls.games.length, 0);
});

test('POST body limit checks actual bytes even when advertised length is absent or false', async () => {
  const provider = fakeProvider(), app = appFor(provider);
  for (const headers of [{}, { 'Content-Length': '1' }, { 'Content-Length': '4097' }]) {
    const response = await app.fetch(request('/api/nba/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(question({ padding: 'x'.repeat(4097) })) }), ENV);
    assert.equal(response.status, 400);
  }
  assert.equal(provider.calls.games.length, 0);
});

test('browser POSTs require the exact same origin; no-origin and same-origin service requests work', async () => {
  const provider = fakeProvider(), app = appFor(provider);
  for (const origin of ['https://other.example', 'null', `${ORIGIN}.attacker.example`]) {
    assert.equal((await app.fetch(post('/api/nba/ask', question(), { Origin: origin }), ENV)).status, 403);
  }
  assert.equal(provider.calls.games.length, 0);
  assert.equal((await app.fetch(post('/api/nba/ask', question(), { Origin: ORIGIN }), ENV)).status, 200);
  assert.equal((await app.fetch(post('/api/nba/ask', question()), ENV)).status, 200);
});

test('extractive answer crosses HTTP with exact source identity, dates and deterministic scores', async () => {
  const app = appFor(fakeProvider());
  const response = await app.fetch(post('/api/nba/ask', question()), ENV);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'supported');
  assert.match(body.answer, /BOS 115/);
  assert.match(body.answer, /won by 10 points; combined score 220 points/);
  assert.deepEqual(body.citations, [{ id: 'bdl-game-41', title: `LAL at BOS — ${DATE}`, url: 'https://api.balldontlie.io/v1/games/41', kind: 'provider', asOf: STAMP, fetchedAt: STAMP, eventDate: DATE }]);
  assert.equal(body.evidence[0].sourceId, body.citations[0].id);
  assert.equal(body.metrics.embeddingCalls + body.metrics.generationCalls + body.metrics.modelCalls, 0);
  assert.equal(body.mode, 'retrieval + extractive explanation');
});

test('ask game ID constrains retrieval and cannot substitute another matchup', async () => {
  const app = appFor(fakeProvider());
  for (const [gameId, code] of [[42, 'team_not_returned'], [999, 'game_not_returned']]) {
    const body = await (await app.fetch(post('/api/nba/ask', question({ gameId })), ENV)).json();
    assert.equal(body.status, 'insufficient');
    assert.equal(body.code, code);
    assert.deepEqual(body.citations, []);
  }
  const body = await (await app.fetch(post('/api/nba/ask', question({ gameId: 41 })), ENV)).json();
  assert.deepEqual(body.citations.map(citation => citation.id), ['bdl-game-41']);
});

test('RAG disabled or unapproved refuses before provider and model operations', async () => {
  const provider = fakeProvider(); let models = 0, pipelines = 0;
  const app = appFor(provider, { modelFactory: () => { models++; assert.fail('Disabled route must not construct models'); }, pipelineFactory: () => { pipelines++; assert.fail('Disabled route must not construct pipeline'); } });
  for (const env of [{}, { ...ENV, AI_API_ENABLED: 'false' }, { ...ENV, AI_SPENDING_APPROVED: 'false' }]) {
    const response = await app.fetch(post('/api/nba/rag', question()), env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'model_not_connected');
  }
  assert.equal(provider.calls.games.length + models + pipelines, 0);
});

test('RAG integration forwards only selected game documents to a scripted test pipeline', async () => {
  const received = [];
  const app = appFor(fakeProvider(), {
    modelFactory: () => ({ embed: async () => [], generate: async () => ({}), status: { state: 'configured' } }),
    pipelineFactory: config => { assert.deepEqual(config.allowedSourceHosts, ['api.balldontlie.io']); return { run: async input => { received.push(input); return { status: 'scripted-test-only' }; } }; },
  });
  assert.equal((await app.fetch(post('/api/nba/rag', question({ gameId: 41 })), ENV)).status, 200);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].documents.map(document => document.source.id), ['bdl-game-41']);
  assert.equal(received[0].question, question().question);
  assert.ok(received[0].signal instanceof AbortSignal);
  const missing = await (await app.fetch(post('/api/nba/rag', question({ gameId: 999 })), ENV)).json();
  assert.equal(missing.status, 'insufficient');
  assert.equal(received.length, 1);
});

test('application retains model adapters and their lifetime call budget across requests and status checks', async () => {
  let factories = 0, pipelines = 0, networkCalls = 0; const instances = [];
  const app = appFor(fakeProvider(), {
    modelFactory: config => { factories++; const instance = createModelAdapters({ ...config, limits: { maxCalls: 2 }, fetchImpl: async () => { networkCalls++; return json({ data: [{ index: 0, embedding: [1, 0] }] }); } }); instances.push(instance); return instance; },
    pipelineFactory: config => { pipelines++; return { run: async () => { await config.embed({ texts: ['synthetic budget probe'] }); return { status: 'scripted-test-only' }; } }; },
  });
  assert.equal((await app.fetch(post('/api/nba/rag', question()), ENV)).status, 200);
  const status = await (await app.fetch(request('/api/nba/status'), ENV)).json();
  assert.equal(status.model.liveVerified, false);
  assert.equal((await app.fetch(post('/api/nba/rag', question()), ENV)).status, 200);
  assert.equal((await app.fetch(post('/api/nba/rag', question()), ENV)).status, 502);
  assert.equal(factories, 1); assert.equal(pipelines, 1); assert.equal(networkCalls, 2);
  assert.equal(instances[0].status.calls, 2); assert.equal(instances[0].status.remainingCalls, 0);
  assert.ok(!JSON.stringify(status).includes(SECRET));
  const changed = { ...ENV, OPENAI_GENERATION_MODEL: 'another-test-generation' };
  assert.equal((await app.fetch(post('/api/nba/rag', question()), changed)).status, 200);
  assert.equal(factories, 2); assert.equal(pipelines, 2);
});

test('static assets use an explicit whitelist, CSP, HEAD, conditional caching and no provider operations', async () => {
  let providerFactories = 0;
  const app = createApplication({ assets: { '/index.html': { body: '<main>Private test</main>', type: 'text/html; charset=utf-8', etag: '"test"' }, '/real-data.js': { body: '/* test */', type: 'text/javascript', etag: '"script"' } }, providerFactory: () => { providerFactories++; assert.fail('Static assets must not touch provider'); } });
  const response = await app.fetch(request('/'));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<main>Private test</main>');
  assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(response.headers.get('content-security-policy'), /object-src 'none'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'private, no-cache');
  const head = await app.fetch(request('/real-data.js', { method: 'HEAD' }));
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  const cached = await app.fetch(request('/', { headers: { 'If-None-Match': '"test"' } }));
  assert.equal(cached.status, 304); assert.equal(await cached.text(), '');
  for (const path of ['/server/application.mjs', '/.env', '/../server/application.mjs', '/%2e%2e/server/application.mjs', '/%2Fserver%2Fapplication.mjs', '/unknown.js']) assert.equal((await app.fetch(request(path))).status, 404, path);
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await app.fetch(request('/real-data.js', { method }))).status, 405);
  assert.equal(providerFactories, 0);
});

test('unknown API paths and unsupported methods fail without invoking data methods', async () => {
  const provider = fakeProvider(), app = appFor(provider);
  assert.equal((await app.fetch(request('/api/nba/missing'), ENV)).status, 404);
  assert.equal((await app.fetch(request('/api/nba/games', { method: 'HEAD' }), ENV)).status, 405);
  assert.equal((await app.fetch(request('/api/nba/ask', { method: 'DELETE' }), ENV)).status, 405);
  assert.equal(provider.calls.games.length + provider.calls.teams, 0);
});

// A minimal DOM plus controlled promises tests the actual browser module's race
// boundary without adding a browser dependency or sending a real HTTP request.
function browserHarness() {
  const elements = new Map(), pending = [];
  const element = tag => ({ tag, value: '', textContent: '', children: [], listeners: {}, hidden: false, disabled: false,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
  });
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); }, createElement: element };
  const context = { document, Date, Intl, AbortController, setTimeout, clearTimeout,
    fetch: (path, options) => path === '/api/nba/status'
      ? Promise.resolve(json({ provider: { configured: true, lastSuccessAt: null }, model: { state: 'unavailable' } }))
      : new Promise((resolve, reject) => pending.push({ path, options, resolve, reject })),
  };
  const source = readFileSync(new URL('../dist/real-data.js', import.meta.url), 'utf8');
  runInNewContext(`${source}\nglobalThis.testApi = { loadGames, askGames, ui };`, context);
  return { ...context.testApi, elements, pending, get: id => document.getElementById(id) };
}

test('real-data UI ignores games and errors that arrive after a date change', async () => {
  for (const rejects of [false, true]) {
    const browser = browserHarness(); browser.get('real-date').value = DATE;
    const load = browser.loadGames();
    assert.equal(browser.pending[0].path, `/api/nba/games?date=${DATE}`);
    browser.get('real-date').value = '2026-11-17';
    browser.get('real-date').listeners.change();
    if (rejects) browser.pending[0].reject(new Error('STALE_TEST_FAILURE'));
    else browser.pending[0].resolve(json(result()));
    await load;
    assert.equal(browser.ui.result, null); assert.equal(browser.ui.loadedDate, null);
    assert.equal(browser.get('real-games-grid').children.length, 0);
    assert.equal(browser.get('real-question-form').hidden, true);
    assert.equal(browser.get('real-message').textContent, 'Date changed. Load provider records for the new date.');
    assert.equal(browser.get('real-load').disabled, false);
  }
});

test('real-data UI ignores an old answer after the selected date changes', async () => {
  const browser = browserHarness(); browser.get('real-date').value = DATE;
  const load = browser.loadGames(); browser.pending[0].resolve(json(result())); await load;
  assert.equal(browser.ui.loadedDate, DATE);
  browser.get('real-question').value = 'What is the Celtics score?';
  const submitter = { disabled: false };
  const ask = browser.askGames({ preventDefault() {}, submitter });
  assert.equal(JSON.parse(browser.pending[1].options.body).date, DATE);
  browser.get('real-date').value = '2026-11-17'; browser.get('real-date').listeners.change();
  browser.pending[1].resolve(json({ status: 'supported', answer: 'STALE_TEST_ANSWER', citations: [] }));
  await ask;
  assert.equal(browser.get('real-answer').children.length, 0);
  assert.equal(browser.ui.loadedDate, null);
  assert.equal(submitter.disabled, false);
});
