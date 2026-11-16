import { AS_OF, EVIDENCE, FIXTURES, SOURCE_REGISTRY, SOURCES } from './evidence.js';
export { AS_OF, EVIDENCE, FIXTURES, SOURCE_REGISTRY, SOURCES } from './evidence.js';

export const ENGINE_VERSION = '1.0.0';
export const MODE = 'retrieval + extractive explanation';
export const LIMITS = Object.freeze({ questionCharacters: 1200, retrievalDocuments: 5, traceEntries: 20 });
const CLOCK = () => globalThis.performance?.now?.() ?? Date.now();
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const sportName = s => ({ nba: 'basketball', basketball: 'basketball' })[String(s ?? '').toLowerCase()] ?? null;
const registry = new Map(SOURCE_REGISTRY.map(s => [s.id, s]));
const aliases = { bos: 'boston', nyk: 'knicks', lal: 'lakers', gsw: 'warriors', tor: 'toronto', mia: 'miami', teams: 'team', matchup: 'match', matchups: 'match', stats: 'metrics', tempo: 'pace', efficient: 'efficiency', efg: 'effective', likelihood: 'probability', chances: 'probability', chance: 'probability', forecast: 'probability', forecasts: 'probability', hypothetical: 'scenario', hypotheticality: 'scenario', absent: 'absence', unavailable: 'absence', injuries: 'injury', injured: 'injury', sources: 'source', citations: 'source', explain: 'explanation', definition: 'meaning', definitions: 'meaning', rating: 'rating' };
export const TEAM_ALIASES = Object.freeze({
  BOS: ['bos', 'boston', 'celtics'], NYK: ['nyk', 'new york', 'knicks'],
  LAL: ['lal', 'los angeles lakers', 'lakers'], GSW: ['gsw', 'golden state', 'warriors'],
  TOR: ['tor', 'toronto', 'raptors'], MIA: ['mia', 'miami', 'heat'],
  ATL: ['atl', 'atlanta', 'hawks'], BKN: ['bkn', 'brooklyn', 'nets'],
  CHA: ['cha', 'charlotte', 'hornets'], CHI: ['chi', 'chicago', 'bulls'],
  CLE: ['cle', 'cleveland', 'cavaliers', 'cavs'], DAL: ['dal', 'dallas', 'mavericks', 'mavs'],
  DEN: ['den', 'denver', 'nuggets'], DET: ['det', 'detroit', 'pistons'],
  HOU: ['hou', 'houston', 'rockets'], IND: ['ind', 'indiana', 'pacers'],
  LAC: ['lac', 'clippers'], MEM: ['mem', 'memphis', 'grizzlies'],
  MIL: ['mil', 'milwaukee', 'bucks'], MIN: ['min', 'minnesota', 'timberwolves', 'wolves'],
  NOP: ['nop', 'new orleans', 'pelicans'], OKC: ['okc', 'oklahoma city', 'thunder'],
  ORL: ['orl', 'orlando', 'magic'], PHI: ['phi', 'philadelphia', '76ers', 'sixers'],
  PHX: ['phx', 'phoenix', 'suns'], POR: ['por', 'portland', 'trail blazers', 'blazers'],
  SAC: ['sac', 'sacramento', 'kings'], SAS: ['sas', 'san antonio', 'spurs'],
  UTA: ['uta', 'utah', 'jazz'], WAS: ['wsh', 'washington', 'wizards']
});
Object.values(TEAM_ALIASES).forEach(Object.freeze);
const normalizedWords = question => ` ${question.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
function mentionsTeam(question, code) {
  const normalized = normalizedWords(question);
  return TEAM_ALIASES[code]?.some(name => normalized.includes(` ${name} `)) ?? false;
}
function hasOutOfScopeTeam(question, f) {
  return Object.keys(TEAM_ALIASES).some(code => code !== f.home.code && code !== f.away.code && mentionsTeam(question, code));
}
const stop = new Set('a an and are as at be by can do does for from how i in is it me my of on or please tell that the their this to us was what which who why with would you your'.split(' '));
export function tokenize(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/e\s*fg%?/g, ' effective ').match(/[a-z0-9]+/g)?.filter(t => !stop.has(t)).map(t => aliases[t] ?? t) ?? [];
}

// Small, actual supervised text model. Training examples are separate from held-out tests.
export const INTENT_TRAINING = Object.freeze({
  matchup: ['Compare these two teams', 'Explain Boston versus New York matchup', 'Which team has the synthetic edge', 'Show the match profile', 'Compare Lakers Warriors team metrics', 'What is the matchup outlook', 'Tell me the team strengths and weaknesses', 'Why is the home side the favorite'],
  definition: ['What does pace mean', 'Define offensive rating', 'Explain effective field goal percentage', 'How is offensive efficiency measured', 'What is a possession', 'Explain field goal attempts', 'What does eFG mean', 'Explain scoring efficiency statistics'],
  scenario: ['Change the hypothetical injury scenario', 'What if a player is absent', 'How does fatigue change probability', 'Explain the availability slider', 'Calculate the scenario penalty', 'What happens with greater workload', 'Show the synthetic win probability formula', 'How is the baseline percentage adjusted'],
  provenance: ['Where are the sources', 'Explain the evidence assistant architecture', 'Is the data synthetic', 'How does retrieval work', 'Which model powers the AI', 'Show the method and citations', 'Is this forecast validated', 'What is the data provenance'],
  availability: ['Who is injured today', 'Get current injury news', 'What is the live score', 'When is the next scheduled game', 'Latest player availability report', 'Are real feeds connected', 'Show current results', 'What data is actually available'],
  unrelated: ['Write a recipe for soup', 'How do I change a bicycle tyre', 'Tell me about quantum mechanics', 'What is the weather in London', 'Summarize a novel', 'Who won the presidential election', 'Translate a sentence into French', 'Explain my tax return']
});

function trainNaiveBayes(examples) {
  const vocabulary = new Set();
  const classes = Object.entries(examples).map(([label, phrases]) => {
    const counts = new Map();
    let total = 0;
    phrases.flatMap(tokenize).forEach(t => { vocabulary.add(t); counts.set(t, (counts.get(t) ?? 0) + 1); total++; });
    return { label, counts, total, documents: phrases.length };
  });
  return { vocabulary, classes, documents: Object.values(examples).flat().length };
}
const intentModel = trainNaiveBayes(INTENT_TRAINING);
export function classifyIntent(question) {
  const tokens = tokenize(question).filter(t => intentModel.vocabulary.has(t));
  if (!tokens.length) return { intent: 'unrelated', confidence: 0, knownTokenCount: 0, model: 'multinomial-naive-bayes-v1' };
  const scores = intentModel.classes.map(c => ({ label: c.label, score: Math.log(c.documents / intentModel.documents) + tokens.reduce((sum, t) => sum + Math.log(((c.counts.get(t) ?? 0) + 1) / (c.total + intentModel.vocabulary.size)), 0) }));
  scores.sort((a, b) => b.score - a.score);
  const denominator = scores.reduce((sum, s) => sum + Math.exp(s.score - scores[0].score), 0);
  return { intent: scores[0].label, confidence: round(1 / denominator), knownTokenCount: tokens.length, model: 'multinomial-naive-bayes-v1' };
}

const injection = /(?:ignore|disregard|override|forget)[\s\S]{0,65}(?:instructions|rules|system|previous)|(?:reveal|show|print|dump|exfiltrate)[\s\S]{0,60}(?:secret|api[\s_-]*key|system[\s_-]*prompt|password|environment[\s_-]*variable)|(?:system|developer)\s*:\s*(?:you|ignore)|<\/?(?:script|iframe|system|developer)\b|javascript\s*:|(?:fetch|curl)\s*\([^)]*(?:secret|token)/i;
const staking = /(?:how much|what amount|how many)[\s\S]{0,60}(?:bet|wager|stake)|\b(?:staking|stake|bankroll|kelly|parlay|accumulator)\b|recover (?:my )?losses|bet (?:my |the )?(?:rent|savings)|guaranteed (?:profit|win)/i;
export function isSafeEvidenceDocument(document) {
  if (!document || typeof document.text !== 'string' || typeof document.title !== 'string' || document.text.length > 6000) return false;
  const source = registry.get(document.sourceId);
  if (!source || injection.test(`${document.title} ${document.text}`)) return false;
  if (source.url && !/^https:\/\/www\.nba\.com\//.test(source.url)) return false;
  return ['all', 'basketball'].includes(document.sport);
}

const legalCorpus = EVIDENCE.filter(isSafeEvidenceDocument);
const indexed = legalCorpus.map(d => ({ document: d, tokens: tokenize(`${d.title} ${d.text}`) }));
const averageLength = indexed.reduce((n, d) => n + d.tokens.length, 0) / indexed.length;
const documentFrequency = new Map();
indexed.forEach(d => new Set(d.tokens).forEach(t => documentFrequency.set(t, (documentFrequency.get(t) ?? 0) + 1)));
const INTENT_HINTS = { matchup: 'synthetic demonstration matchup baseline', definition: 'meaning', scenario: 'scenario absence workload penalties', provenance: 'sources retrieval evidence method connected', availability: 'connected current live availability', unrelated: '' };

export function resolveFixture(sport, matchupId) {
  const resolvedSport = sportName(sport);
  const idAliases = { 'bos-nyk': 'nba-bos-nyk', 'BOS-NYK': 'nba-bos-nyk' };
  if (!resolvedSport) return null;
  return matchupId ? FIXTURES.find(f => f.sport === resolvedSport && f.id === (idAliases[matchupId] ?? matchupId)) ?? null : FIXTURES.find(f => f.sport === resolvedSport);
}

export function retrieveEvidence({ question, sport, matchupId, limit = 4, intent } = {}) {
  const resolvedSport = sportName(sport);
  const f = resolveFixture(sport, matchupId);
  if (typeof question !== 'string' || !question.trim() || question.length > LIMITS.questionCharacters || !resolvedSport || !f || injection.test(question) || hasOutOfScopeTeam(question, f)) return [];
  const queryTokens = [...new Set(tokenize(question))];
  const hints = tokenize(INTENT_HINTS[intent] ?? '');
  // Require a real query overlap before routing hints can improve ranking.
  return indexed.filter(({ document: d }) => (d.sport === resolvedSport || d.sport === 'all') && (!d.matchupId || d.matchupId === f.id)).map(({ document: d, tokens }) => {
    const overlap = queryTokens.filter(t => tokens.includes(t)).length;
    if (!overlap) return { ...d, score: 0 };
    let score = 0;
    for (const t of [...queryTokens, ...hints]) {
      const tf = tokens.filter(x => x === t).length;
      if (!tf) continue;
      const df = documentFrequency.get(t) ?? 0;
      const idf = Math.log(1 + (indexed.length - df + 0.5) / (df + 0.5));
      score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * tokens.length / averageLength)) * (queryTokens.includes(t) ? 1 : 0.18);
    }
    if (d.matchupId === f.id && intent === 'matchup') score += 1.5;
    return { ...d, score: round(score) };
  }).filter(d => d.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, clamp(Math.trunc(Number(limit) || 4), 1, LIMITS.retrievalDocuments));
}

function unitNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
  return clamp(value, 0, 1);
}

export function calculateScenario(sport, availability = 0, fatigue = 0, baseline) {
  const resolvedSport = sportName(sport);
  if (!resolvedSport) throw new TypeError('Unsupported sport');
  if (availability && typeof availability === 'object') {
    const scenario = availability;
    availability = scenario.availability ?? 0;
    fatigue = scenario.fatigue ?? 0;
    baseline = scenario.baselineProbability ?? baseline;
  }
  const absenceImpact = unitNumber(availability, 'availability');
  const workload = unitNumber(fatigue, 'fatigue');
  const base = baseline ?? 58;
  if (typeof base !== 'number' || !Number.isFinite(base) || base < 5 || base > 95) throw new TypeError('Baseline must be a finite percentage from 5 to 95');
  const availabilityPenalty = round(absenceImpact * 10);
  const fatiguePenalty = round(workload * 5);
  const probability = round(clamp(base - availabilityPenalty - fatiguePenalty, 5, 95));
  return { baselineProbability: base, probability, adjustedProbability: probability, awayProbability: round(100 - probability), change: round(probability - base), availabilityPenalty, fatiguePenalty, availability: absenceImpact, fatigue: workload, unit: 'percent', kind: 'synthetic', validated: false };
}

export function calculateEffectiveFieldGoal(made, threes, attempted) {
  if (![made, threes, attempted].every(Number.isInteger) || made < 0 || threes < 0 || attempted <= 0 || threes > made || made > attempted) throw new TypeError('Use valid nonnegative whole shot counts and at least one attempt');
  return round(100 * (made + 0.5 * threes) / attempted);
}

const telemetry = { requests: 0, supported: 0, insufficient: 0, refused: 0, totalLatencyMs: 0, traces: [] };
export function getObservabilitySnapshot() {
  return { requests: telemetry.requests, supported: telemetry.supported, insufficient: telemetry.insufficient, refused: telemetry.refused, meanLatencyMs: telemetry.requests ? round(telemetry.totalLatencyMs / telemetry.requests) : 0, externalAPICalls: 0, externalModelCalls: 0, apiCostUSD: 0, traceRetention: 'last 20 requests in browser memory; no raw questions', traces: telemetry.traces.map(t => ({ ...t })) };
}
export function resetObservability() {
  telemetry.requests = telemetry.supported = telemetry.insufficient = telemetry.refused = telemetry.totalLatencyMs = 0;
  telemetry.traces.length = 0;
}

const scenarioText = (f, result) => `${f.home.code} synthetic baseline: ${result.baselineProbability}%. Hypothetical absence penalty: −${result.availabilityPenalty} percentage points; workload penalty: −${result.fatiguePenalty} points. Result: ${result.probability}% ${f.home.code}, ${result.awayProbability}% ${f.away.code}. This is an invented sensitivity demonstration, not an injury report or a validated prediction. The baseline is hand-authored, not inferred from the displayed metrics.`;
const matchupText = document => `${document.text}\n\nNo current injury information is connected. Explore absence impact only as an explicit assumption.`;
function metricComparison(f, metricIndex) {
  const metric = f.metrics[metricIndex];
  const difference = round(metric.home - metric.away);
  const definitionDoc = EVIDENCE.find(d => d.id === ['nba-offrtg', 'nba-pace', 'nba-efg'][metricIndex]);
  const higher = difference > 0 ? f.home.code : difference < 0 ? f.away.code : 'Neither team';
  return {
    definitionDoc,
    answer: `Synthetic fixture · ${metric.label}: ${f.home.code} ${metric.home}, ${f.away.code} ${metric.away} ${metric.unit}. ${higher} has the higher displayed value${difference === 0 ? ' (a tie)' : ` by ${Math.abs(difference)} ${metric.unit}`}. The difference (${f.home.code} minus ${f.away.code}) is ${difference > 0 ? '+' : ''}${difference}. All inputs are invented; this comparison is not current team performance or a forecast.\n\n${definitionDoc.text}`,
    metrics: { label: metric.label, home: metric.home, away: metric.away, difference, unit: metric.unit, kind: 'synthetic', validated: false }
  };
}

function answerRecord(start, status, answer, docs = [], metrics = {}, classification = null, reason = '') {
  const citations = [...new Set(docs.map(d => d.sourceId))].map(id => ({ ...registry.get(id) }));
  const latencyMs = round(Math.max(0, CLOCK() - start));
  telemetry.requests++;
  telemetry[status]++;
  telemetry.totalLatencyMs += latencyMs;
  telemetry.traces.push({ requestId: telemetry.requests, status, intent: classification?.intent ?? 'guard', evidenceIds: docs.map(d => d.id), latencyMs, reason });
  if (telemetry.traces.length > LIMITS.traceEntries) telemetry.traces.shift();
  return { status, answer, citations, evidence: docs.map(d => ({ ...d })), metrics, latencyMs, mode: MODE, classification, reason, asOf: AS_OF, engineVersion: ENGINE_VERSION };
}

export function getEvidenceAnswer(input = {}) {
  const start = CLOCK();
  const respond = (status, answer, docs = [], metrics = {}, classification = null, reason = '') => answerRecord(start, status, answer, docs, metrics, classification, reason);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return respond('insufficient', 'Supply a question, sport and supported synthetic matchup.', [], {}, null, 'invalid-input');
  const { question, sport, matchupId, scenario = {} } = input;
  if (typeof question !== 'string' || !question.trim() || question.length > LIMITS.questionCharacters) return respond('insufficient', `Use a question of 1–${LIMITS.questionCharacters} characters.`, [], {}, null, 'invalid-question');
  if (injection.test(question)) return respond('refused', 'I can explain the approved sports evidence. I cannot follow instructions to reveal secrets, change the evidence rules or execute embedded code.', [], {}, null, 'unsafe-instruction');
  if (staking.test(question)) return respond('refused', 'I cannot choose stakes or provide a personal betting plan. These synthetic, unvalidated percentages cannot establish betting value. I can explain the scenario, uncertainty and sources.', [], {}, null, 'personal-staking');
  const resolvedSport = sportName(sport);
  const f = resolveFixture(sport, matchupId);
  if (!resolvedSport || !f) return respond('insufficient', 'Select one of the available NBA synthetic matchups. No evidence is connected for that selection.', [], {}, null, 'unsupported-scope');
  const q = question.toLowerCase();
  const classification = classifyIntent(question);
  const availabilityDoc = EVIDENCE.find(d => d.id === 'availability-report');
  const methodDoc = EVIDENCE.find(d => d.id === 'method-scenarios');
  const fixtureDoc = EVIDENCE.find(d => d.matchupId === f.id);
  const hypothetical = /scenario|hypothetical|what if|slider|simulate|simulation|assum(?:e|ption)|illustrative|fictional/.test(q);
  const wantsCurrent = /\b(?:today|tonight|latest|live|currently|current|yesterday|tomorrow|right now|actual|real-time)\b/.test(q);
  const injury = /\binjur(?:y|ies|ed)|\b(?:out|doubtful|questionable|available|availability|lineup|roster)\b/.test(q);
  const asksConnected = /connect|feed|\bapi\b|data source|data available|actually available|what data|real data|(?:is|are) .{0,35}(?:synthetic|invented|fabricated)/.test(q);
  // Current injury and result claims cannot be answered by a dated fixture.
  if ((!hypothetical && injury && !asksConnected) || (wantsCurrent && !asksConnected && !/meaning|define|definition|notation/.test(q)) || /\b(?:scheduled|schedule|tipoff|start time|scoreboard|final score|won last|recent form)\b/.test(q)) {
    return respond('insufficient', 'No live scores, current schedule or reliable current injury feed is connected. I cannot verify that claim. The selected matchup contains invented team metrics only; use the hypothetical scenario to explore an assumed absence without naming a real injured player.', [availabilityDoc], {}, classification, 'current-data-unavailable');
  }
  if (/\b(?:cricket|football|soccer|tennis|baseball|hockey|t20)\b/.test(q)) return respond('insufficient', 'This MVP contains NBA evidence only. No evidence for that sport is connected.', [], {}, classification, 'unsupported-sport');
  if (hasOutOfScopeTeam(question, f)) return respond('insufficient', 'That team is outside the selected synthetic matchup. Select an available matchup to keep the evidence correctly scoped; other NBA teams have no connected evidence.', [], {}, classification, 'cross-matchup');
  if (/\b(?:how many games|games (?:won|lost|played)|(?:season|career|team) record|wins|losses|won|lost|standings|rankings?|rebounds?|assists?|blocks?|steals?|turnovers?|true shooting|defensive rating|points per game|ppg|player stats?|player ratings?|last \d+ games|head to head|historical results|home record|away record)\b/.test(q)) return respond('insufficient', 'The selected fixture does not contain that statistic or result. Available invented team metrics are offensive rating, pace and eFG%. There is no connected season record, player-stat or historical-results dataset.', [availabilityDoc], {}, classification, 'unsupported-statistic');

  if (asksConnected || /\b(?:sources?|provenance|citations?|retrieval|rag|llm|architecture|model|trained|calibrat|backtest|validated)\b/.test(q)) {
    const docs = /retrieval|rag|llm|architecture|model|assistant/.test(q) ? [EVIDENCE.find(d => d.id === 'method-retrieval'), availabilityDoc] : [availabilityDoc, EVIDENCE.find(d => d.id === 'method-probability')];
    return respond('supported', docs.map(d => d.text).join('\n\n'), docs, { connectedFeeds: 0, externalModelCalls: 0 }, classification, 'provenance');
  }

  if (hypothetical || /fatigue|workload|penalt|probability|baseline|odds|forecast/.test(q)) {
    let result;
    try {
      if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) throw new TypeError('Scenario must contain numeric slider values');
      result = calculateScenario(resolvedSport, scenario.availability ?? 0, scenario.fatigue ?? 0, f.baselineProbability);
    } catch {
      return respond('insufficient', 'Scenario inputs must be finite numbers for absence impact and workload, each from 0 to 1. No calculation was produced.', [], {}, classification, 'invalid-scenario');
    }
    return respond('supported', scenarioText(f, result), [fixtureDoc, methodDoc], result, classification, 'synthetic-scenario');
  }

  const metricIndex = /offensive (?:rating|efficiency)|offense/.test(q) ? 0 : /\b(?:pace|tempo)\b/.test(q) ? 1 : /effective field goal|\befg\b/.test(q) ? 2 : -1;
  const asksTeamMetric = metricIndex >= 0 && (/\b(?:compare|higher|lower|difference|edge|between|versus|vs|matchup)\b|(?:these|the|both) teams?/.test(q) || mentionsTeam(question, f.home.code) || mentionsTeam(question, f.away.code));
  if (asksTeamMetric) {
    const comparison = metricComparison(f, metricIndex);
    return respond('supported', comparison.answer, [fixtureDoc, comparison.definitionDoc], comparison.metrics, classification, 'synthetic-metric-comparison');
  }

  const docs = retrieveEvidence({ question, sport: resolvedSport, matchupId: f.id, intent: classification.intent, limit: 3 });
  const definitions = docs.filter(d => d.kind === 'official-reference');
  if (definitions.length && /meaning|mean|define|explain|what|how|pace|rating|effective|efg/.test(q)) {
    return respond('supported', definitions.map(d => d.text).join('\n\n'), definitions, {}, classification, 'definition');
  }
  const asksMatchup = /matchup|compare|versus|\bvs\b|favorite|favourite|edge|strength|weakness|profile|team|offen|stat|metric|analy[sz]|outlook/.test(q) || [f.home.code, f.away.code, f.home.name, f.away.name].some(name => q.includes(name.toLowerCase()));
  if (asksMatchup && docs.some(d => d.matchupId === f.id)) return respond('supported', matchupText(fixtureDoc), [fixtureDoc, availabilityDoc], { baselineProbability: f.baselineProbability, kind: 'synthetic', validated: false }, classification, 'synthetic-matchup');
  return respond('insufficient', 'The approved evidence does not support that question. Try the selected synthetic matchup, a stat definition, the scenario formula or data provenance.', [], {}, classification, 'no-supporting-evidence');
}

export function validateAnswerRecord(record) {
  if (!record || !['supported', 'insufficient', 'refused'].includes(record.status) || typeof record.answer !== 'string' || record.mode !== MODE || record.asOf !== AS_OF || record.engineVersion !== ENGINE_VERSION || !Array.isArray(record.citations) || !Array.isArray(record.evidence) || !Number.isFinite(record.latencyMs) || record.latencyMs < 0 || !record.metrics || typeof record.metrics !== 'object' || Array.isArray(record.metrics) || record.evidence.some(d => !d || typeof d !== 'object') || record.citations.some(c => !c || typeof c !== 'object')) return false;
  const sourceIds = new Set(record.evidence.map(d => d.sourceId));
  const citationIds = new Set(record.citations.map(c => c.id));
  if (citationIds.size !== record.citations.length || new Set(record.evidence.map(d => d.id)).size !== record.evidence.length) return false;
  const equalFlat = (a, b) => a && b && Object.keys(a).length === Object.keys(b).length && Object.keys(b).every(key => Object.is(a[key], b[key]));
  const fields = ['id', 'title', 'text', 'sourceId', 'kind', 'asOf', 'sport', 'matchupId', 'url'];
  if (!record.evidence.every(d => legalCorpus.some(original => fields.every(key => d[key] === original[key])) && citationIds.has(d.sourceId)) || !record.citations.every(c => registry.has(c.id) && sourceIds.has(c.id) && equalFlat(c, registry.get(c.id)))) return false;
  if (record.status !== 'supported') return equalFlat(record.metrics, {});
  if (!record.evidence.length) return false;
  const fixtureDoc = record.evidence.find(d => d.matchupId);
  const f = FIXTURES.find(fixture => fixture.id === fixtureDoc?.matchupId);
  if (record.reason === 'synthetic-matchup') return Boolean(f && equalFlat(record.metrics, { baselineProbability: f.baselineProbability, kind: 'synthetic', validated: false }) && record.answer === matchupText(fixtureDoc));
  if (record.reason === 'synthetic-scenario') {
    if (!f) return false;
    try {
      const expected = calculateScenario(f.sport, record.metrics.availability, record.metrics.fatigue, f.baselineProbability);
      return equalFlat(record.metrics, expected) && record.answer === scenarioText(f, expected);
    } catch { return false; }
  }
  if (record.reason === 'synthetic-metric-comparison') {
    const index = f?.metrics.findIndex(m => m.label === record.metrics.label) ?? -1;
    if (index < 0) return false;
    const expected = metricComparison(f, index);
    return equalFlat(record.metrics, expected.metrics) && record.answer === expected.answer;
  }
  if (record.reason === 'definition') return equalFlat(record.metrics, {}) && record.evidence.every(d => d.kind === 'official-reference') && record.answer === record.evidence.map(d => d.text).join('\n\n');
  if (record.reason === 'provenance') return equalFlat(record.metrics, { connectedFeeds: 0, externalModelCalls: 0 }) && record.answer === record.evidence.map(d => d.text).join('\n\n');
  return false;
}
