/**
 * Server-only BALLDONTLIE NBA free-tier boundary. Import this from server code only.
 * No default key, account creation, automatic retry, polling, or paid endpoint exists.
 * Provider contract: https://nba.balldontlie.io/ (reviewed 2026-11-16).
 */

const ORIGIN = 'https://api.balldontlie.io';
const PROVIDER = 'BALLDONTLIE';
const MIN_YEAR = 1946;
const WINDOW_MS = 60000;
const REQUEST_LIMIT = 5;
const MAX_CONCURRENT = 5;
const MAX_PAGE_SIZE = 100;
export const NBA_COVERAGE = Object.freeze({
  injuries: 'requires-paid-plan', playerStats: 'requires-paid-plan', forecasts: 'not-available',
});
const MESSAGES = Object.freeze({
  not_configured: 'NBA data is not connected. Configure the server-side provider key.',
  invalid_input: 'The NBA request or configuration is invalid.',
  auth_failed_or_tier: 'The provider rejected authentication or account-tier access.',
  rate_limited: 'The NBA request budget is exhausted. Wait before another manual request.',
  upstream_unavailable: 'The NBA provider is temporarily unavailable or exceeded the request deadline.',
  invalid_response: 'The NBA provider returned an unsupported or invalid response.',
});

/** Only fixed, safe messages cross the HTTP/UI boundary; never attach provider errors. */
export class NbaProviderError extends Error {
  constructor(code, { retryAfterMs } = {}) {
    const safeCode = typeof code === 'string' && Object.hasOwn(MESSAGES, code) ? code : 'upstream_unavailable';
    super(MESSAGES[safeCode]);
    this.name = 'NbaProviderError';
    this.code = safeCode;
    if (Number.isSafeInteger(retryAfterMs) && retryAfterMs > 0) this.retryAfterMs = retryAfterMs;
  }
}
const fail = (code, options) => { throw new NbaProviderError(code, options); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const clone = value => structuredClone(value);
const positiveId = value => Number.isSafeInteger(value) && value > 0;

function text(value, max, { empty = false, nullable = false, code = 'invalid_response' } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001F\u007F]/u.test(value)) fail(code);
  const clean = value.trim();
  if (!empty && !clean) fail(code);
  return clean;
}

function calendarDate(value, now, code = 'invalid_response') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) fail(code);
  const year = Number(value.slice(0, 4));
  const instant = Date.parse(`${value}T00:00:00.000Z`);
  if (year < MIN_YEAR || year > new Date(now).getUTCFullYear() + 1 || !Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== value) fail(code);
  return value;
}

function validClock(now) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8640000000000000) fail('invalid_input');
  return now;
}

/** Whitelist the display fields, preserving historical IDs rather than assuming IDs 1..30. */
export function normalizeTeam(value) {
  if (!record(value) || !positiveId(value.id)) fail('invalid_response');
  return {
    id: value.id,
    abbreviation: text(value.abbreviation, 12),
    name: text(value.name, 100),
    fullName: text(value.full_name, 160),
    city: text(value.city, 100, { empty: true }),
  };
}

function lifecycle(value, rawStatus) {
  // An explicit lifecycle state is authoritative, including unknown/interrupted games.
  // Never infer completion from period=4, a past date, or a nonzero score.
  if (value.status_state !== undefined && value.status_state !== null) {
    const state = text(value.status_state, 40);
    const known = { final: 'final', in_progress: 'live', scheduled: 'scheduled' };
    return { status: own(known, state) ? known[state] : 'unknown', statusState: state };
  }
  if (value.postponed === true) return { status: 'unknown', statusState: 'postponed' };
  let status = 'unknown';
  if (/^final(?:\/(?:\d+)?ot)?$/iu.test(rawStatus ?? '')) status = 'final';
  else if (/^(?:(?:1st|2nd|3rd|4th) qtr|halftime|ot|\d+(?:st|nd|rd|th) ot)$/iu.test(rawStatus ?? '')) status = 'live';
  else if (/^(?:scheduled|(?:[1-9]|1[0-2]):[0-5]\d\s*(?:am|pm)(?:\s+(?:et|est|edt))?)$/iu.test(rawStatus ?? '')) status = 'scheduled';
  return { status, statusState: null };
}

function score(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 500) fail('invalid_response');
  return value;
}

/** Nullable lifecycle fields are tolerated; scheduled/unknown games cannot look like 0–0 results. */
export function normalizeGame(value, { now = Date.now() } = {}) {
  validClock(now);
  if (!record(value) || !positiveId(value.id)) fail('invalid_response');
  const date = calendarDate(value.date, now);
  if (!Number.isInteger(value.season) || value.season < MIN_YEAR || value.season > new Date(now).getUTCFullYear() + 1 || typeof value.postseason !== 'boolean') fail('invalid_response');
  const period = value.period ?? null;
  if (period !== null && (!Number.isInteger(period) || period < 0 || period > 30)) fail('invalid_response');
  if (own(value, 'postponed') && typeof value.postponed !== 'boolean') fail('invalid_response');
  const rawStatus = text(value.status, 100, { empty: true, nullable: true }) || null;
  const { status, statusState } = lifecycle(value, rawStatus);
  const homeTeam = normalizeTeam(value.home_team), awayTeam = normalizeTeam(value.visitor_team);
  if (homeTeam.id === awayTeam.id) fail('invalid_response');
  const rawHomeScore = score(value.home_team_score), rawAwayScore = score(value.visitor_team_score);
  if (status === 'final' && (rawHomeScore === null || rawAwayScore === null)) fail('invalid_response');
  const hasScore = status === 'live' || status === 'final';
  return {
    id: value.id, date, season: value.season, status, rawStatus, statusState, period,
    postseason: value.postseason, homeTeam, awayTeam,
    homeScore: hasScore ? rawHomeScore : null,
    awayScore: hasScore ? rawAwayScore : null,
  };
}

function normalizePlayer(value) {
  if (!record(value) || !positiveId(value.id)) fail('invalid_response');
  const firstName = text(value.first_name, 100, { empty: true });
  const lastName = text(value.last_name, 100, { empty: true });
  if (!firstName && !lastName) fail('invalid_response');
  return {
    id: value.id, firstName, lastName, fullName: `${firstName} ${lastName}`.trim(),
    position: text(value.position, 24, { empty: true, nullable: true }),
    team: value.team == null ? null : normalizeTeam(value.team),
  };
}

function argumentsObject(value, required, optional = []) {
  if (!record(value) || required.some(key => !own(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('invalid_input');
}

function pagination(payload, paginated) {
  if (payload.meta === undefined && !paginated) return { partial: false, nextCursor: null };
  if (!record(payload.meta)) fail('invalid_response');
  const cursor = payload.meta.next_cursor ?? null;
  if (cursor !== null && !positiveId(cursor)) fail('invalid_response');
  if (payload.meta.per_page !== undefined && (!Number.isInteger(payload.meta.per_page) || payload.meta.per_page < 1 || payload.meta.per_page > MAX_PAGE_SIZE)) fail('invalid_response');
  return { partial: cursor !== null, nextCursor: cursor };
}

function responseHeader(response, name) {
  try { return response.headers?.get(name) ?? null; } catch { fail('invalid_response'); }
}
function cancelBody(response) {
  try { Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch { /* best effort only */ }
}

/** Count actual streamed bytes, including when Content-Length is absent or misleading. */
async function boundedJson(response, maxResponseBytes) {
  const contentType = responseHeader(response, 'content-type');
  if (typeof contentType !== 'string' || !/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/iu.test(contentType)) {
    cancelBody(response); fail('invalid_response');
  }
  const contentLength = responseHeader(response, 'content-length');
  if (contentLength !== null && /^\d+$/u.test(contentLength) && Number(contentLength) > maxResponseBytes) {
    cancelBody(response); fail('invalid_response');
  }
  if (!response.body || typeof response.body.getReader !== 'function') fail('invalid_response');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, reads = 0;
  const parts = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) fail('invalid_response');
      bytes += value.byteLength;
      if (bytes > maxResponseBytes || ++reads > 4096) fail('invalid_response');
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return JSON.parse(parts.join(''));
  } catch {
    // Parsing, decoding and transport errors may contain bodies or credentials.
    try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* best effort */ }
    fail('invalid_response');
  } finally {
    try { reader.releaseLock(); } catch { /* a pending read can retain the lock */ }
  }
}

function retryDelay(response, now) {
  const value = responseHeader(response, 'retry-after');
  if (typeof value !== 'string' || value.length > 128) return WINDOW_MS;
  const delay = /^\d+$/u.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) && delay > 0 ? Math.min(3600000, Math.max(1000, Math.ceil(delay))) : WINDOW_MS;
}

/**
 * Cache and quota are shared across this factory's endpoint methods. Construct one
 * provider per server process, not per incoming HTTP request. Multiple processes
 * need a shared external quota/cache before scaling (the local guard cannot do that).
 */
export function createNbaProvider(options = {}) {
  argumentsObject(options, [], ['apiKey', 'fetchImpl', 'now', 'timeoutMs', 'maxResponseBytes', 'maxCacheEntries', 'teamsCacheTtlMs', 'gamesCacheTtlMs', 'playersCacheTtlMs', 'trace']);
  const {
    apiKey = '', fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 8000,
    maxResponseBytes = 1048576, maxCacheEntries = 32, teamsCacheTtlMs = 86400000,
    gamesCacheTtlMs = 300000, playersCacheTtlMs = 86400000, trace = () => {},
  } = options;
  if (typeof apiKey !== 'string' || apiKey.length > 512 || (apiKey && !/^[\x21-\x7E]+$/u.test(apiKey)) || typeof fetchImpl !== 'function' || typeof now !== 'function' || typeof trace !== 'function') fail('invalid_input');
  for (const [value, min, max] of [[timeoutMs, 1, 30000], [maxResponseBytes, 128, 2097152], [maxCacheEntries, 1, 64], [teamsCacheTtlMs, 1, 86400000], [gamesCacheTtlMs, 1, 300000], [playersCacheTtlMs, 1, 86400000]]) {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail('invalid_input');
  }
  const clock = () => validClock(now());
  clock();
  const cache = new Map(), inFlight = new Map(), requests = [];
  let state = apiKey ? 'ready' : 'not_configured', lastSuccessAt = null, cooldownUntil = 0, activeRequests = 0;
  const emit = event => { try { trace(clone(event)); } catch { /* telemetry cannot break data delivery */ } };
  const prune = at => {
    while (requests.length && at - requests[0] >= WINDOW_MS) requests.shift();
    for (const [key, item] of cache) if (at < item.at || at - item.at >= item.ttlMs) cache.delete(key);
  };
  const quota = at => {
    prune(at);
    const windowDelay = requests.length >= REQUEST_LIMIT ? Math.max(1, requests[0] + WINDOW_MS - at) : 0;
    return { limit: REQUEST_LIMIT, windowMs: WINDOW_MS, remaining: Math.max(0, REQUEST_LIMIT - requests.length), retryAfterMs: Math.max(0, cooldownUntil - at, windowDelay) };
  };

  async function requestList(operation, params, normalize, ttlMs, { paginated = true, matches = () => true } = {}) {
    if (!apiKey) fail('not_configured');
    const startedAt = clock(), path = `/v1/${operation}`, url = new URL(path, ORIGIN);
    for (const [key, value] of params) url.searchParams.append(key, value);
    const cacheKey = url.href;
    prune(startedAt);
    if (cache.has(cacheKey)) {
      const item = cache.get(cacheKey);
      cache.delete(cacheKey); cache.set(cacheKey, item);
      const result = clone(item.result); result.provenance.cache = 'hit';
      emit({ operation, status: 'success', cache: 'hit', itemCount: result.data.length, elapsedMs: 0 });
      return result;
    }
    if (inFlight.has(cacheKey)) return clone(await inFlight.get(cacheKey));
    const budget = quota(startedAt);
    if (budget.retryAfterMs > 0) { state = 'rate_limited'; fail('rate_limited', { retryAfterMs: budget.retryAfterMs }); }
    if (activeRequests >= MAX_CONCURRENT) fail('upstream_unavailable');
    requests.push(startedAt); activeRequests++;
    const controller = new AbortController();
    let timeout;
    // Keep the active slot until underlying I/O settles, even when a mock/adapter
    // ignores cancellation. A deadline must not enable unlimited hanging requests.
    const work = (async () => {
      let response;
      try {
        response = await fetchImpl(url.href, {
          method: 'GET', headers: { Authorization: apiKey, Accept: 'application/json' },
          redirect: 'error', credentials: 'omit', signal: controller.signal,
        });
      } catch { fail('upstream_unavailable'); }
      if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599) fail('invalid_response');
      if (response.status === 401 || response.status === 403) { cancelBody(response); fail('auth_failed_or_tier'); }
      if (response.status === 429) {
        const delay = retryDelay(response, clock());
        cooldownUntil = Math.max(cooldownUntil, clock() + delay);
        cancelBody(response); fail('rate_limited', { retryAfterMs: delay });
      }
      if (response.status < 200 || response.status >= 300) { cancelBody(response); fail('upstream_unavailable'); }
      const payload = await boundedJson(response, maxResponseBytes);
      if (!record(payload) || !Array.isArray(payload.data) || payload.data.length > MAX_PAGE_SIZE) fail('invalid_response');
      const page = pagination(payload, paginated), fetchedAt = clock();
      const data = payload.data.map(value => normalize(value, { now: fetchedAt }));
      if (new Set(data.map(item => item.id)).size !== data.length || !data.every(matches)) fail('invalid_response');
      return {
        data,
        provenance: { provider: PROVIDER, fetchedAt: new Date(fetchedAt).toISOString(), providerUpdatedAt: null, dataMode: 'provider', sourceUrl: `${ORIGIN}${path}`, cache: 'miss' },
        coverage: { ...NBA_COVERAGE }, pagination: page,
      };
    })();
    work.then(() => { activeRequests--; }, () => { activeRequests--; });
    const deadline = new Promise((resolve, reject) => {
      timeout = setTimeout(() => { controller.abort(); reject(new NbaProviderError('upstream_unavailable')); }, timeoutMs);
    });
    const pending = Promise.race([work, deadline]);
    inFlight.set(cacheKey, pending);
    try {
      const result = await pending, completedAt = clock();
      // Only validated, deadline-completing responses are cached or marked connected.
      state = 'connected'; lastSuccessAt = result.provenance.fetchedAt;
      cache.set(cacheKey, { result: clone(result), at: completedAt, ttlMs });
      while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
      emit({ operation, status: 'success', cache: 'miss', itemCount: result.data.length, elapsedMs: Math.max(0, completedAt - startedAt) });
      return clone(result);
    } catch (error) {
      const safe = error instanceof NbaProviderError ? error : new NbaProviderError('upstream_unavailable');
      state = safe.code;
      emit({ operation, status: 'error', code: safe.code, cache: 'miss', elapsedMs: Math.max(0, clock() - startedAt) });
      throw safe;
    } finally {
      clearTimeout(timeout); inFlight.delete(cacheKey);
    }
  }

  return Object.freeze({
    async getTeams(input) {
      if (input !== undefined) fail('invalid_input');
      return requestList('teams', [], normalizeTeam, teamsCacheTtlMs, { paginated: false });
    },
    async getGames(input) {
      argumentsObject(input, ['date'], ['teamId']);
      const date = calendarDate(input.date, clock(), 'invalid_input');
      if (input.teamId !== undefined && !positiveId(input.teamId)) fail('invalid_input');
      const teamId = input.teamId;
      const params = [['dates[]', date], ['per_page', String(MAX_PAGE_SIZE)]];
      if (teamId !== undefined) params.push(['team_ids[]', String(teamId)]);
      return requestList('games', params, normalizeGame, gamesCacheTtlMs, { matches: game => game.date === date && (teamId === undefined || game.homeTeam.id === teamId || game.awayTeam.id === teamId) });
    },
    async getPlayers(input) {
      argumentsObject(input, ['search']);
      const search = text(input.search, 64, { code: 'invalid_input' });
      if (search.length < 2 || !/^[\p{L}\p{M} .’'-]+$/u.test(search)) fail('invalid_input');
      // This endpoint includes historical players; it does not establish active rosters.
      return requestList('players', [['search', search], ['per_page', String(MAX_PAGE_SIZE)]], normalizePlayer, playersCacheTtlMs);
    },
    getStatus() {
      return {
        provider: PROVIDER, configured: Boolean(apiKey), state, lastSuccessAt,
        coverage: { ...NBA_COVERAGE }, rateLimit: quota(clock()),
        cache: { entries: cache.size, inFlight: inFlight.size, activeRequests },
      };
    },
    clearCache() { cache.clear(); },
  });
}
