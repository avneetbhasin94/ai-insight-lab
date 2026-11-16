import { createNbaProvider, NbaProviderError } from './nba-provider.mjs';
import { answerGameQuestion, buildGameDocuments } from './live-evidence.mjs';
import { createRagPipeline } from './rag.mjs';
import { createModelAdapters } from './model-adapters.mjs';

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const BASE_HEADERS = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cache-Control': 'no-store' };
const ERROR_STATUS = { invalid_input: 400, not_configured: 503, auth_failed_or_tier: 502, rate_limited: 429, invalid_response: 502, upstream_unavailable: 502 };
const MESSAGES = { not_configured: 'The free NBA provider key is not configured. No real games have been loaded.', invalid_input: 'Use a valid NBA date, team or question.', auth_failed_or_tier: 'The provider did not authorize this request. Check the key and endpoint coverage.', rate_limited: 'The free provider request budget is exhausted. Try again after the displayed delay.', invalid_response: 'The provider response could not be verified. No replacement scores were invented.', upstream_unavailable: 'The NBA provider is unavailable. Please try later.' };
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra } });
const error = (code, status = 400, extra = {}) => json({ status: 'unavailable', code, message: MESSAGES[code] ?? 'This request is unavailable.', ...extra }, status);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

async function readBody(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new TypeError('Expected JSON');
  if (Number(request.headers.get('content-length')) > 4096) throw new TypeError('Request too large');
  const reader = request.body?.getReader(); if (!reader) throw new TypeError('Missing JSON');
  let bytes = 0, text = ''; const decoder = new TextDecoder();
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 4096) throw new TypeError('Request too large'); text += decoder.decode(value, { stream: true }); }
    text += decoder.decode(); const body = JSON.parse(text); if (!isRecord(body)) throw new TypeError('Expected object'); return body;
  } catch { await reader.cancel().catch(() => {}); throw new TypeError('Invalid JSON'); }
}

/** The native owner-private Sites gate protects this application. No account/SSO
 * stack or public unauthenticated update route is introduced by this migration. */
export function createApplication({ assets = {}, providerFactory = createNbaProvider, modelFactory = createModelAdapters, pipelineFactory = createRagPipeline, now = Date.now } = {}) {
  let provider, currentKey, pipeline, modelSignature, modelAdapters, modelConfigSignature;
  function providerFor(env) {
    const key = typeof env.BALLDONTLIE_API_KEY === 'string' ? env.BALLDONTLIE_API_KEY : '';
    if (!provider || currentKey !== key) { provider = providerFactory({ apiKey: key, now }); currentKey = key; }
    return provider;
  }
  function modelFor(env) {
    const config = { enabled: env.AI_API_ENABLED === 'true', apiKey: env.OPENAI_API_KEY, embeddingModel: env.OPENAI_EMBEDDING_MODEL, generationModel: env.OPENAI_GENERATION_MODEL };
    const signature = JSON.stringify([config.enabled, config.apiKey, config.embeddingModel, config.generationModel]);
    if (!modelAdapters || modelConfigSignature !== signature) { modelAdapters = modelFactory(config); modelConfigSignature = signature; pipeline = undefined; }
    return { adapters: modelAdapters, config };
  }
  async function runModel(env, question, result, date, signal, gameId) {
    const { adapters, config } = modelFor(env);
    if (!adapters.embed || !adapters.generate) return json({ status: 'unavailable', code: 'model_not_connected', message: 'Real NBA data and model-generated RAG are separate. AI calls are disabled until model setup, billing authorization and spending controls are approved.' }, 503);
    // No browser control can enable this route. The flag is server configuration.
    // These per-instance limits are not a global dollar cap; production activation
    // also requires provider billing controls and a durable shared spending ledger.
    if (env.AI_SPENDING_APPROVED !== 'true') return json({ status: 'unavailable', code: 'spending_not_approved', message: 'Model configuration is present but paid usage has not been authorized.' }, 503);
    const signature = JSON.stringify([config.apiKey, config.embeddingModel, config.generationModel]);
    if (!pipeline || modelSignature !== signature) {
      pipeline = pipelineFactory({ embed: adapters.embed, generate: adapters.generate, allowedSourceHosts: ['api.balldontlie.io'], modelId: config.generationModel, embeddingId: config.embeddingModel, limits: { maxConcurrentRuns: 1, maxDocuments: 12, maxChunks: 36, maxOutputTokens: 600, maxQuestionChars: 600 }, now }); modelSignature = signature;
    }
    const scoped = gameId === undefined ? result : { ...result, data: result.data.filter(game => game.id === gameId) };
    const documents = scoped.data.length ? buildGameDocuments(scoped, { date }).slice(0, 12) : [];
    if (!documents.length) return json({ status: 'insufficient', code: 'no_games', message: 'No provider game records are available for this date.' });
    return json(await pipeline.run({ question, documents, signal }));
  }
  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url), path = url.pathname;
      if (!['GET', 'HEAD', 'POST'].includes(request.method)) return error('method_not_allowed', 405);
      if (!path.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(request.method)) return error('method_not_allowed', 405);
        const asset = assets[path === '/' ? '/index.html' : path];
        if (!asset) return new Response('Not found', { status: 404, headers: BASE_HEADERS });
        const headers = { ...BASE_HEADERS, 'Content-Type': asset.type, 'Cache-Control': 'private, no-cache', ETag: asset.etag };
        if (request.headers.get('if-none-match') === asset.etag) return new Response(null, { status: 304, headers });
        return new Response(request.method === 'HEAD' ? null : asset.body, { headers });
      }
      if (request.method === 'HEAD') return error('method_not_allowed', 405);
      const nba = providerFor(env);
      try {
        if (path === '/api/nba/status' && request.method === 'GET') {
          const { adapters } = modelFor(env);
          return json({ provider: nba.getStatus(), model: { state: adapters.status?.state ?? 'unavailable', liveVerified: false, paidCallsEnabled: Boolean(env.AI_API_ENABLED === 'true' && env.AI_SPENDING_APPROVED === 'true' && adapters.embed && adapters.generate), requiresSeparateAuthorization: true }, access: 'owner-private-site', updatePolicy: 'Manual refresh with shared per-instance cache; no automatic polling.', predictionStatus: 'No trained or validated outcome model.' });
        }
        if (path === '/api/nba/teams' && request.method === 'GET') { if ([...url.searchParams].length) return error('invalid_input'); return json(await nba.getTeams()); }
        if (path === '/api/nba/games' && request.method === 'GET') {
          if ([...url.searchParams.keys()].some(k => !['date', 'teamId'].includes(k)) || ['date', 'teamId'].some(k => url.searchParams.getAll(k).length > 1)) return error('invalid_input');
          const team = url.searchParams.get('teamId'); if (team !== null && !/^[1-9]\d{0,8}$/.test(team)) return error('invalid_input'); return json(await nba.getGames({ date: url.searchParams.get('date'), ...(team ? { teamId: Number(team) } : {}) }));
        }
        if (['/api/nba/ask', '/api/nba/rag'].includes(path) && request.method === 'POST') {
          // Browser POSTs must be same-origin. Service access can omit Origin and
          // remains protected by the owner-private Sites boundary.
          if (request.headers.has('origin') && request.headers.get('origin') !== url.origin) return error('cross_origin', 403);
          const body = await readBody(request);
          if (Object.keys(body).some(k => !['question', 'date', 'gameId'].includes(k)) || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 600 || (body.gameId !== undefined && (!Number.isSafeInteger(body.gameId) || body.gameId < 1))) return error('invalid_input');
          if (path === '/api/nba/rag' && (env.AI_API_ENABLED !== 'true' || env.AI_SPENDING_APPROVED !== 'true')) return json({ status: 'unavailable', code: 'model_not_connected', message: 'Real model calls are disabled. The working evidence answers use retrieval and extraction, not a language model.' }, 503);
          const result = await nba.getGames({ date: body.date });
          if (path === '/api/nba/rag') return await runModel(env, body.question.trim(), result, body.date, request.signal, body.gameId);
          return json(answerGameQuestion({ question: body.question.trim(), result, date: body.date, gameId: body.gameId }));
        }
        return error('not_found', 404);
      } catch (problem) {
        if (problem instanceof NbaProviderError) return error(problem.code, ERROR_STATUS[problem.code] ?? 502, Number.isFinite(problem.retryAfterMs) ? { retryAfterMs: problem.retryAfterMs } : {});
        if (problem instanceof TypeError) return error('invalid_input');
        // No provider response body, prompt, credential or stack reaches visitors.
        return error('upstream_unavailable', 502);
      }
    }
  };
}
