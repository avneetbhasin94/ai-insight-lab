import test from 'node:test';
import assert from 'node:assert/strict';
import { createNbaProvider, normalizeTeam, normalizeGame, NbaProviderError, NBA_COVERAGE } from '../server/nba-provider.mjs';

// Synthetic schema fixtures, not provider-verified teams, games, injuries or forecasts.
const NOW = Date.parse('2026-11-16T12:00:00.000Z');
const SECRET = 'PRIVATE_TEST_API_KEY';
const team = (id = 1, overrides = {}) => ({ id, abbreviation: id === 1 ? 'HBR' : 'VLY', name: id === 1 ? 'Harbor' : 'Valley', full_name: id === 1 ? 'Harbor Example' : 'Valley Example', city: 'Example City', ...overrides });
const game = (overrides = {}) => ({
  id: 15907925, date: '2026-11-16', season: 2026, status: 'Final', status_state: 'final',
  period: 4, postseason: false, postponed: false, home_team_score: 115, visitor_team_score: 105,
  home_team: team(1), visitor_team: team(2), datetime: null, time: null, ist_stage: null,
  ...overrides,
});
const json = (value, init = {}) => new Response(JSON.stringify(value), { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });
const page = (data = [], meta = { next_cursor: null, per_page: 100 }) => ({ data, meta });
const errorCode = code => error => error instanceof NbaProviderError && error.code === code;
const make = (fetchImpl, options = {}) => createNbaProvider({ apiKey: SECRET, now: () => NOW, fetchImpl, ...options });

test('unconfigured provider has no network activity and cannot imply a verified connection', async () => {
  let calls = 0;
  const provider = createNbaProvider({ fetchImpl: async () => { calls++; }, now: () => NOW });
  assert.equal(provider.getStatus().configured, false);
  assert.equal(provider.getStatus().state, 'not_configured');
  assert.equal(provider.getStatus().lastSuccessAt, null);
  await assert.rejects(provider.getTeams(), errorCode('not_configured'));
  await assert.rejects(provider.getGames({ date: '2026-11-16' }), errorCode('not_configured'));
  await assert.rejects(provider.getPlayers({ search: 'Example' }), errorCode('not_configured'));
  assert.equal(calls, 0);
  assert.equal(make(async () => {}).getStatus().state, 'ready');
});

test('factory rejects unsafe keys, unsupported configuration and unbounded budgets', () => {
  for (const options of [{ apiKey: ['key'] }, { apiKey: 'key\nheader' }, { apiKey: 'key with spaces' }, { apiKey: 'x'.repeat(513) }, { baseUrl: 'https://elsewhere.example' }, { timeoutMs: 30001 }, { maxResponseBytes: 9999999 }, { maxCacheEntries: 10000 }, { gamesCacheTtlMs: 300001 }, { now: () => NaN }, { fetchImpl: 'fetch' }]) {
    assert.throws(() => createNbaProvider(options), errorCode('invalid_input'));
  }
});

test('teams use fixed origin, raw Authorization and safe dated provenance; no paid methods exist', async () => {
  const calls = [], events = [];
  const provider = make(async (url, init) => { calls.push({ url, init }); return json({ data: [team()] }); }, { trace: event => events.push(event) });
  const result = await provider.getTeams();
  assert.equal(calls[0].url, 'https://api.balldontlie.io/v1/teams');
  assert.deepEqual(calls[0].init.headers, { Authorization: SECRET, Accept: 'application/json' });
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.deepEqual(result.data, [{ id: 1, abbreviation: 'HBR', name: 'Harbor', fullName: 'Harbor Example', city: 'Example City' }]);
  assert.deepEqual(result.provenance, { provider: 'BALLDONTLIE', fetchedAt: '2026-11-16T12:00:00.000Z', providerUpdatedAt: null, dataMode: 'provider', sourceUrl: 'https://api.balldontlie.io/v1/teams', cache: 'miss' });
  assert.deepEqual(result.coverage, NBA_COVERAGE);
  assert.deepEqual(result.pagination, { partial: false, nextCursor: null });
  assert.equal(provider.getStatus().state, 'connected');
  assert.equal(provider.getStatus().lastSuccessAt, result.provenance.fetchedAt);
  assert.equal(provider.getInjuries, undefined);
  assert.equal(provider.getPlayerStats, undefined);
  assert.ok(!JSON.stringify({ result, status: provider.getStatus(), events }).includes(SECRET));
});

test('team normalizer preserves historical IDs, whitelists fields and rejects coercion', () => {
  assert.equal(normalizeTeam(team(987654, { ignored: 'extra' })).id, 987654);
  assert.equal(normalizeTeam(team(1, { city: '' })).city, '');
  assert.equal(normalizeTeam(team()).ignored, undefined);
  for (const value of [null, [], team('1'), team(0), team(1.5), team(Number.MAX_SAFE_INTEGER + 1), team(1, { full_name: ['Harbor'] }), team(1, { name: { toString: () => 'Harbor' } }), team(1, { abbreviation: 'x'.repeat(13) }), team(1, { name: 'unsafe\nname' })]) {
    assert.throws(() => normalizeTeam(value), errorCode('invalid_response'));
  }
});

test('game normalizer trusts lifecycle state, not quarter, date, zero score or raw Final', () => {
  const final = normalizeGame(game(), { now: NOW });
  assert.equal(final.status, 'final');
  assert.equal(final.homeScore, 115);
  assert.equal(final.period, 4);
  assert.equal(normalizeGame(game({ status: 'Final/2OT', period: 4 }), { now: NOW }).status, 'final');
  const scheduled = normalizeGame(game({ status_state: 'scheduled', home_team_score: 0, visitor_team_score: 0 }), { now: NOW });
  assert.equal(scheduled.status, 'scheduled');
  assert.equal(scheduled.homeScore, null);
  assert.equal(scheduled.awayScore, null);
  const live = normalizeGame(game({ status_state: 'in_progress', period: 1, home_team_score: 0, visitor_team_score: 0 }), { now: NOW });
  assert.equal(live.status, 'live');
  assert.equal(live.homeScore, 0);
  for (const status_state of ['unknown', 'postponed', 'canceled', 'delayed', 'suspended', 'abandoned', 'future_state', '__proto__', 'constructor']) {
    const value = normalizeGame(game({ status_state }), { now: NOW });
    assert.equal(value.status, 'unknown', status_state);
    assert.equal(value.statusState, status_state);
    assert.equal(value.homeScore, null);
    assert.equal(value.awayScore, null);
  }
});

test('legacy lifecycle fallback is deliberately narrow and nullable fields remain nullable', () => {
  for (const status of ['Final', 'Final/OT', 'Final/2OT']) assert.equal(normalizeGame(game({ status_state: undefined, status }), { now: NOW }).status, 'final');
  for (const status of ['1st Qtr', '4th Qtr', 'Halftime', 'OT', '2nd OT']) assert.equal(normalizeGame(game({ status_state: null, status }), { now: NOW }).status, 'live');
  for (const status of ['7:00 pm ET', '12:30 AM', 'Scheduled']) assert.equal(normalizeGame(game({ status_state: undefined, status }), { now: NOW }).status, 'scheduled');
  const unknown = normalizeGame(game({ status_state: undefined, status: null, period: null, home_team_score: null, visitor_team_score: null }), { now: NOW });
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.rawStatus, null);
  assert.equal(unknown.period, null);
  assert.equal(unknown.homeScore, null);
  assert.equal(normalizeGame(game({ status_state: undefined, status: 'possibly Final eventually', period: 4 }), { now: NOW }).status, 'unknown');
  assert.equal(normalizeGame(game({ status_state: undefined, status: '1th Qtr' }), { now: NOW }).status, 'unknown');
  assert.equal(normalizeGame(game({ status_state: undefined, postponed: true }), { now: NOW }).status, 'unknown');
});

test('scores and required game fields are typed; incomplete final scores cannot become results', () => {
  for (const overrides of [{ home_team_score: '115' }, { home_team_score: NaN }, { home_team_score: -1 }, { home_team_score: 501 }, { visitor_team_score: null }, { period: '4' }, { period: -1 }, { postseason: 'false' }, { postponed: null }, { season: '2026' }, { season: 1945 }, { home_team: team(2) }, { status: ['Final'] }, { status_state: ['final'] }]) {
    assert.throws(() => normalizeGame(game(overrides), { now: NOW }), errorCode('invalid_response'));
  }
  assert.equal(normalizeGame(game({ status_state: 'in_progress', home_team_score: null }), { now: NOW }).homeScore, null);
});

test('calendar dates reject rollover, coercion, timestamps and out-of-range years before I/O', async () => {
  let calls = 0;
  const provider = make(async () => { calls++; return json(page()); });
  for (const date of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-01-32', '2026-1-01', '2026-11-16T00:00:00Z', '1945-12-31', '2028-01-01', ['2026-11-16'], { toString: () => '2026-11-16' }, null]) {
    await assert.rejects(provider.getGames({ date }), errorCode('invalid_input'));
    assert.throws(() => normalizeGame(game({ date }), { now: NOW }), errorCode('invalid_response'));
  }
  await provider.getGames({ date: '2024-02-29' });
  await provider.getGames({ date: '1946-11-01' });
  await provider.getGames({ date: '2027-12-31' });
  assert.equal(calls, 3);
});

test('limited game parameters encode one date and optional numeric team; arbitrary URLs are refused', async () => {
  const calls = [];
  const provider = make(async url => { calls.push(new URL(url)); return json(page([game({ home_team: team(999) })])); });
  await provider.getGames({ date: '2026-11-16', teamId: 999 });
  const url = calls[0];
  assert.equal(url.origin, 'https://api.balldontlie.io');
  assert.deepEqual([...url.searchParams], [['dates[]', '2026-11-16'], ['per_page', '100'], ['team_ids[]', '999']]);
  for (const input of [null, [], {}, { date: '2026-11-16', teamId: '1' }, { date: '2026-11-16', teamId: [1] }, { date: '2026-11-16', teamId: -1 }, { date: '2026-11-16', url: 'https://elsewhere.example' }, { date: '2026-11-16', cursor: 1 }]) await assert.rejects(provider.getGames(input), errorCode('invalid_input'));
  await assert.rejects(provider.getTeams({}), errorCode('invalid_input'));
  assert.equal(calls.length, 1);
});

test('results inconsistent with the selected game date or team fail closed', async () => {
  const dateMismatch = make(async () => json(page([game({ date: '2026-11-15' })])));
  await assert.rejects(dateMismatch.getGames({ date: '2026-11-16' }), errorCode('invalid_response'));
  const teamMismatch = make(async () => json(page([game()])));
  await assert.rejects(teamMismatch.getGames({ date: '2026-11-16', teamId: 999 }), errorCode('invalid_response'));
  assert.equal(dateMismatch.getStatus().lastSuccessAt, null);
});

test('one bounded page reports the next cursor and never fetches it automatically', async () => {
  let calls = 0;
  const provider = make(async () => { calls++; return json(page([game()], { next_cursor: 100, per_page: 100 })); });
  const result = await provider.getGames({ date: '2026-11-16' });
  assert.deepEqual(result.pagination, { partial: true, nextCursor: 100 });
  assert.equal(calls, 1);
});

test('malformed pagination, oversized pages and duplicate IDs cannot imply complete coverage', async () => {
  const invalidPayloads = [
    null, [], { data: {} }, { data: [game()] }, page([game()], null),
    page([game()], { next_cursor: ['100'] }), page([game()], { next_cursor: '100' }), page([game()], { per_page: 101 }),
    page([game(), game()]), page(Array.from({ length: 101 }, (_, i) => game({ id: i + 1 }))),
  ];
  for (const payload of invalidPayloads) {
    const provider = make(async () => json(payload));
    await assert.rejects(provider.getGames({ date: '2026-11-16' }), errorCode('invalid_response'));
    assert.equal(provider.getStatus().lastSuccessAt, null);
    assert.equal(provider.getStatus().cache.entries, 0);
  }
});

test('free player search is bounded and normalized without implying active rosters', async () => {
  const calls = [];
  const provider = make(async url => { calls.push(new URL(url)); return json(page([{ id: 115, first_name: 'Example', last_name: 'Player', position: 'G', team: team(999), salary: 'IGNORED' }])); });
  const result = await provider.getPlayers({ search: 'Example Player' });
  assert.deepEqual(result.data, [{ id: 115, firstName: 'Example', lastName: 'Player', fullName: 'Example Player', position: 'G', team: normalizeTeam(team(999)) }]);
  assert.equal(result.data[0].active, undefined);
  assert.deepEqual([...calls[0].searchParams], [['search', 'Example Player'], ['per_page', '100']]);
  for (const input of [{ search: ['Example'] }, { search: 'x' }, { search: 'x'.repeat(65) }, { search: 'https://elsewhere.example' }, { search: 'Example', active: true }]) await assert.rejects(provider.getPlayers(input), errorCode('invalid_input'));
  assert.equal(calls.length, 1);
});

test('game cache expires at five minutes and clones caller-visible data and provenance', async () => {
  let clock = NOW, calls = 0;
  const provider = make(async () => { calls++; return json(page([game()])); }, { now: () => clock });
  const first = await provider.getGames({ date: '2026-11-16' });
  first.data[0].homeTeam.name = 'Mutated'; first.coverage.injuries = 'false';
  clock += 299999;
  const hit = await provider.getGames({ date: '2026-11-16' });
  assert.equal(hit.provenance.cache, 'hit');
  assert.equal(hit.provenance.fetchedAt, '2026-11-16T12:00:00.000Z');
  assert.equal(hit.provenance.providerUpdatedAt, null);
  assert.equal(hit.data[0].homeTeam.name, 'Harbor');
  assert.equal(hit.coverage.injuries, 'requires-paid-plan');
  clock++;
  const refreshed = await provider.getGames({ date: '2026-11-16' });
  assert.equal(refreshed.provenance.cache, 'miss');
  assert.equal(refreshed.provenance.fetchedAt, '2026-11-16T12:05:00.000Z');
  assert.equal(calls, 2);
});

test('teams cache lasts at most twenty-four hours; a backwards clock does not make stale data fresh', async () => {
  let clock = NOW, calls = 0;
  const provider = make(async () => { calls++; return json({ data: [team()] }); }, { now: () => clock });
  await provider.getTeams();
  clock += 86400000 - 1;
  assert.equal((await provider.getTeams()).provenance.cache, 'hit');
  clock++;
  assert.equal((await provider.getTeams()).provenance.cache, 'miss');
  clock--;
  assert.equal((await provider.getTeams()).provenance.cache, 'miss');
  assert.equal(calls, 3);
});

test('cache has a bounded LRU size and clearCache does not reset the request quota', async () => {
  let calls = 0;
  const provider = make(async () => { calls++; return json(page()); }, { maxCacheEntries: 2 });
  for (const date of ['2026-11-14', '2026-11-15', '2026-11-16']) await provider.getGames({ date });
  assert.equal(provider.getStatus().cache.entries, 2);
  assert.equal((await provider.getGames({ date: '2026-11-14' })).provenance.cache, 'miss');
  provider.clearCache();
  assert.equal(provider.getStatus().cache.entries, 0);
  assert.equal(provider.getStatus().rateLimit.remaining, 1);
  assert.equal(calls, 4);
});

test('identical concurrent requests coalesce before quota consumption and return separate clones', async () => {
  let calls = 0, release;
  const provider = make(async () => { calls++; await new Promise(resolve => { release = resolve; }); return json(page([game()])); });
  const pending = Array.from({ length: 4 }, () => provider.getGames({ date: '2026-11-16' }));
  assert.equal(calls, 1);
  assert.equal(provider.getStatus().cache.inFlight, 1);
  release();
  const results = await Promise.all(pending);
  results[0].data[0].homeTeam.name = 'Changed';
  assert.equal(results[1].data[0].homeTeam.name, 'Harbor');
  assert.equal(provider.getStatus().rateLimit.remaining, 4);
  assert.equal(provider.getStatus().cache.activeRequests, 0);
});

test('five-per-minute guard is shared across free endpoints; cached access remains available', async () => {
  let clock = NOW, calls = 0;
  const provider = make(async url => { calls++; return json(new URL(url).pathname.endsWith('/teams') ? { data: [team()] } : page()); }, { now: () => clock });
  await provider.getTeams();
  await provider.getPlayers({ search: 'Example' });
  for (const date of ['2026-11-14', '2026-11-15', '2026-11-16']) await provider.getGames({ date });
  await assert.rejects(provider.getGames({ date: '2026-11-17' }), error => errorCode('rate_limited')(error) && error.retryAfterMs === 60000);
  assert.equal(provider.getStatus().rateLimit.remaining, 0);
  assert.equal((await provider.getTeams()).provenance.cache, 'hit');
  provider.clearCache();
  await assert.rejects(provider.getTeams(), errorCode('rate_limited'));
  assert.equal(calls, 5);
  clock += 60000;
  await provider.getTeams();
  assert.equal(calls, 6);
});

test('distinct simultaneous requests reserve their quota before fetch and block the sixth', async () => {
  const release = [];
  let calls = 0;
  const provider = make(async () => { calls++; await new Promise(resolve => release.push(resolve)); return json(page()); });
  const pending = Array.from({ length: 5 }, (_, i) => provider.getGames({ date: `2026-11-${String(10 + i).padStart(2, '0')}` }));
  await assert.rejects(provider.getGames({ date: '2026-11-16' }), errorCode('rate_limited'));
  assert.equal(calls, 5);
  release.forEach(resolve => resolve());
  await Promise.all(pending);
  assert.equal(provider.getStatus().cache.activeRequests, 0);
});

test('HTTP errors are classified without reading bodies, leaking secrets or retrying automatically', async () => {
  for (const [status, code] of [[401, 'auth_failed_or_tier'], [403, 'auth_failed_or_tier'], [429, 'rate_limited'], [400, 'upstream_unavailable'], [302, 'upstream_unavailable'], [500, 'upstream_unavailable'], [503, 'upstream_unavailable']]) {
    let calls = 0;
    const events = [];
    const provider = make(async () => { calls++; return new Response(`BODY_WITH_${SECRET}`, { status }); }, { trace: event => events.push(event) });
    await assert.rejects(provider.getTeams(), error => {
      assert.ok(errorCode(code)(error));
      assert.ok(!error.message.includes(SECRET));
      assert.ok(!error.stack.includes(SECRET));
      return true;
    });
    assert.equal(calls, 1);
    assert.equal(provider.getStatus().lastSuccessAt, null);
    assert.ok(!JSON.stringify({ events, status: provider.getStatus() }).includes(SECRET));
  }
});

test('upstream 429 Retry-After creates a bounded local cooldown without retrying', async () => {
  let clock = NOW, calls = 0;
  const provider = make(async () => { calls++; return calls === 1 ? json({ error: SECRET }, { status: 429, headers: { 'Retry-After': '180' } }) : json({ data: [team()] }); }, { now: () => clock });
  await assert.rejects(provider.getTeams(), error => errorCode('rate_limited')(error) && error.retryAfterMs === 180000);
  clock += 60001;
  await assert.rejects(provider.getTeams(), errorCode('rate_limited'));
  assert.equal(calls, 1);
  clock = NOW + 180000;
  await provider.getTeams();
  assert.equal(calls, 2);
  const capped = make(async () => json({}, { status: 429, headers: { 'Retry-After': '9999999999999999' } }));
  await assert.rejects(capped.getTeams(), error => error.retryAfterMs === 3600000);
});

test('provider/network exceptions are redacted even if they imitate adapter error types', async () => {
  for (const external of [new Error(SECRET), new NbaProviderError('auth_failed_or_tier')]) {
    external.message = SECRET;
    const events = [];
    const provider = make(async () => { throw external; }, { trace: event => events.push(event) });
    await assert.rejects(provider.getTeams(), error => errorCode('upstream_unavailable')(error) && !error.message.includes(SECRET));
    assert.ok(!JSON.stringify({ events, status: provider.getStatus() }).includes(SECRET));
  }
});

test('invalid JSON, content types and UTF-8 are safe invalid responses', async () => {
  for (const response of [
    new Response(`${SECRET} {`, { headers: { 'Content-Type': 'application/json' } }),
    new Response(JSON.stringify({ data: [team()] }), { headers: { 'Content-Type': 'text/html' } }),
    new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'Content-Type': 'application/json' } }),
    new Response(null, { status: 204 }),
  ]) {
    const provider = make(async () => response);
    await assert.rejects(provider.getTeams(), error => errorCode('invalid_response')(error) && !error.message.includes(SECRET));
  }
});

test('response size guard checks Content-Length and streamed bytes, including UTF-8 bytes', async () => {
  const oversizedHeader = make(async () => json({ data: [] }, { headers: { 'Content-Length': '4096' } }), { maxResponseBytes: 256 });
  await assert.rejects(oversizedHeader.getTeams(), errorCode('invalid_response'));
  const hiddenOversize = make(async () => json({ data: [], ignored: 'é'.repeat(200) }, { headers: { 'Content-Length': '1' } }), { maxResponseBytes: 256 });
  await assert.rejects(hiddenOversize.getTeams(), errorCode('invalid_response'));
  const withoutLength = make(async () => json({ data: [], ignored: 'x'.repeat(300) }), { maxResponseBytes: 256 });
  await assert.rejects(withoutLength.getTeams(), errorCode('invalid_response'));
  const normal = make(async () => json({ data: [] }), { maxResponseBytes: 256 });
  assert.deepEqual((await normal.getTeams()).data, []);
});

test('body stream errors are redacted and unsuccessful responses are never cached', async () => {
  const stream = new ReadableStream({ pull(controller) { controller.error(new Error(SECRET)); } });
  const provider = make(async () => new Response(stream, { headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(provider.getTeams(), error => errorCode('invalid_response')(error) && !error.message.includes(SECRET));
  assert.equal(provider.getStatus().cache.entries, 0);
  assert.equal(provider.getStatus().lastSuccessAt, null);
});

test('deadline aborts fetch and resolves safely even if the fetch adapter ignores cancellation', async () => {
  let signal;
  const provider = make(async (url, init) => { signal = init.signal; return new Promise(() => {}); }, { timeoutMs: 10 });
  await assert.rejects(provider.getTeams(), errorCode('upstream_unavailable'));
  assert.equal(signal.aborted, true);
  assert.equal(provider.getStatus().cache.inFlight, 0);
  assert.equal(provider.getStatus().cache.activeRequests, 1);
  assert.equal(provider.getStatus().lastSuccessAt, null);
});

test('deadline covers body reads, and ignored aborts cannot accumulate unlimited outstanding I/O', async () => {
  let clock = NOW, calls = 0;
  const provider = make(async () => {
    calls++;
    return new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }), { headers: { 'Content-Type': 'application/json' } });
  }, { timeoutMs: 5, now: () => clock });
  for (let i = 0; i < 5; i++) await assert.rejects(provider.getTeams(), errorCode('upstream_unavailable'));
  assert.equal(provider.getStatus().cache.activeRequests, 5);
  clock += 60000;
  await assert.rejects(provider.getTeams(), errorCode('upstream_unavailable'));
  assert.equal(calls, 5);
});

test('late successful responses after a deadline cannot mark the provider connected or populate cache', async () => {
  let release;
  const provider = make(async () => { await new Promise(resolve => { release = resolve; }); return json({ data: [team()] }); }, { timeoutMs: 5 });
  await assert.rejects(provider.getTeams(), errorCode('upstream_unavailable'));
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(provider.getStatus().cache.activeRequests, 0);
  assert.equal(provider.getStatus().cache.entries, 0);
  assert.equal(provider.getStatus().lastSuccessAt, null);
  assert.equal(provider.getStatus().state, 'upstream_unavailable');
});

test('telemetry is bounded metadata only, tolerates logger failures, and cannot mutate returned data', async () => {
  const events = [];
  const provider = make(async () => json({ data: [team()] }), { trace: event => { events.push({ ...event }); event.itemCount = 999; throw new Error(SECRET); } });
  const result = await provider.getTeams();
  await provider.getTeams();
  assert.equal(result.data.length, 1);
  assert.deepEqual(events.map(event => Object.keys(event).sort()), [
    ['cache', 'elapsedMs', 'itemCount', 'operation', 'status'],
    ['cache', 'elapsedMs', 'itemCount', 'operation', 'status'],
  ]);
  assert.deepEqual(events.map(event => event.cache), ['miss', 'hit']);
  assert.ok(!JSON.stringify(events).includes(SECRET));
});
