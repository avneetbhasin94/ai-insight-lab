/**
 * Connected NBA game evidence. This is lexical retrieval and deterministic,
 * extractive explanation, not vector search or an LLM. No network or keys here.
 * Only the server's normalized BALLDONTLIE result may cross this boundary.
 */

const MAX_ROWS = 100;
const MAX_DOCUMENTS = 12; // Matches the RAG scaffold's default ingestion budget.
const MAX_ANSWERS = 3;
const MAX_QUESTION_CHARS = 600;
const MODE = 'retrieval + extractive explanation';
const API = 'https://api.balldontlie.io/v1/games/';
const ATTACK = /ignore\s+(?:all\s+|any\s+|the\s+|previous\s+|prior\s+|above\s+)*(?:instructions?|rules?|messages?)|(?:reveal|print|exfiltrate|disclose|show)\s+(?:the\s+|your\s+)*(?:system\s+prompt|secrets?|api\s*keys?|access\s*tokens?)|<\/?(?:system|developer|assistant)>|\b(?:system|developer)\s*:/i;
const AVAILABILITY = /\b(?:injur(?:y|ies|ed)|questionable|doubtful|probable|ruled\s+(?:out|in)|out\s+(?:tonight|today)|availab(?:le|ility)|unavailable|healthy|health|hurt|sidelined|lineups?|medical|fitness|suspend(?:ed|sion)|inactive|cleared|(?:is|are|will|can)\s+(?:[a-z'-]+\s+){0,8}(?:play|playing|start|starting|dress|dressing)|game[- ]time)\b/i;
const FORECAST = /\b(?:predict\w*|forecast\w*|probabilit\w*|chances?|odds|bets?|betting|wagers?|profit\w*|accuracy|calibrat\w*|backtests?|guarantee\w*|locks?|picks?|spread|moneyline|over[- ]under)\b|\b(?:will|would|should|going\s+to)\b.*\b(?:win|beat|score|cover)\b|\bwho\s+wins\b|\bwin(?:ning)?\s+percent\w*/i;
const UNSUPPORTED_STAT = /\b(?:players?|rosters?|rebounds?|assists?|steals?|blocks?|turnovers?|fouls?|shooting|shots?|pointers?|free\s+throws?|field\s+goals?|splits?|possessions?|pace|ratings?|efficien\w*|records?|standings?|rank\w*|streaks?|recent|form|last\s+\d+|last\s+(?:five|ten)|averag\w*|per\s+game|season\s+(?:stats?|wins?|losses?|totals?)|histor\w*|head[- ]to[- ]head|h2h|trend\w*|strength\w*|weakness\w*|strategy|defen\w*|offen\w*)\b/i;
const CONTROL = /[\u0000-\u001F\u007F]/;

// Provider IDs and abbreviations are an identity allowlist, never source text.
// Names are rendered from this table so provider payloads cannot inject prose.
const TEAM_ROWS = [
  [1, 'ATL', 'Atlanta', 'Hawks'], [2, 'BOS', 'Boston', 'Celtics'],
  [3, 'BKN', 'Brooklyn', 'Nets'], [4, 'CHA', 'Charlotte', 'Hornets'],
  [5, 'CHI', 'Chicago', 'Bulls'], [6, 'CLE', 'Cleveland', 'Cavaliers'],
  [7, 'DAL', 'Dallas', 'Mavericks'], [8, 'DEN', 'Denver', 'Nuggets'],
  [9, 'DET', 'Detroit', 'Pistons'], [10, 'GSW', 'Golden State', 'Warriors'],
  [11, 'HOU', 'Houston', 'Rockets'], [12, 'IND', 'Indiana', 'Pacers'],
  [13, 'LAC', 'Los Angeles', 'Clippers'], [14, 'LAL', 'Los Angeles', 'Lakers'],
  [15, 'MEM', 'Memphis', 'Grizzlies'], [16, 'MIA', 'Miami', 'Heat'],
  [17, 'MIL', 'Milwaukee', 'Bucks'], [18, 'MIN', 'Minnesota', 'Timberwolves'],
  [19, 'NOP', 'New Orleans', 'Pelicans'], [20, 'NYK', 'New York', 'Knicks'],
  [21, 'OKC', 'Oklahoma City', 'Thunder'], [22, 'ORL', 'Orlando', 'Magic'],
  [23, 'PHI', 'Philadelphia', '76ers'], [24, 'PHX', 'Phoenix', 'Suns'],
  [25, 'POR', 'Portland', 'Trail Blazers'], [26, 'SAC', 'Sacramento', 'Kings'],
  [27, 'SAS', 'San Antonio', 'Spurs'], [28, 'TOR', 'Toronto', 'Raptors'],
  [29, 'UTA', 'Utah', 'Jazz'], [30, 'WAS', 'Washington', 'Wizards'],
];
const EXTRA_ALIASES = {
  CLE: ['cavs'], DAL: ['mavs'], GSW: ['golden state', 'dubs'],
  LAC: ['la clippers'], LAL: ['la lakers'], MIN: ['wolves'],
  NYK: ['new york'], OKC: ['oklahoma city'], PHI: ['sixers', 'philly'],
  POR: ['blazers'], SAS: ['san antonio'],
};
const normalize = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const TEAMS = TEAM_ROWS.map(([id, abbreviation, city, name]) => ({
  id, abbreviation, city, name, fullName: `${city} ${name}`,
  aliases: [...new Set([abbreviation, name, `${city} ${name}`, ...(city === 'Los Angeles' ? [] : [city]), ...(EXTRA_ALIASES[abbreviation] ?? [])].map(normalize))],
}));
const BY_TEAM_ID = new Map(TEAMS.map(team => [team.id, team]));
const ALLOWED_WORDS = new Set(('a an the what which who whom whose how many much is are was were be been being do does did can could has have had for of on at in to from between with and or versus vs v about me us you i please tell show give explain summarize summarise summary selected select this that these those date day daily nba basketball game games matchup matchups slate schedule scheduled scheduling result results score scores scored scoring final finals status live partial current today tonight yesterday tomorrow last night play plays played playing home away team teams opponent opponents point points total totals combined difference differential margin won lost winner winners winning leading lead leads ahead behind tied tie ties beat beaten beating won lost win wins loss losses outcome outcomes report reported update updates happened happening ended end finished finish thanks thank return returned snapshot observed observation fetched time times comparison compare breakdown recap just only all any both them they their its it s against really then now see available').split(' '));
const GAME_INTENT = /\b(?:nba|basketball|games?|matchups?|slate|schedule|results?|scores?|final|status|live|points?|total|combined|difference|differential|margin|won|lost|winners?|winning|leading|lead|ahead|behind|tied|tie|beat|outcomes?|summary|summari[sz]e|recap|compare)\b/i;

export class LiveEvidenceError extends Error {
  constructor(code, message) { super(message); this.name = 'LiveEvidenceError'; this.code = code; }
}
const fail = (code, message) => { throw new LiveEvidenceError(code, message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const idOf = value => {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^[1-9]\d{0,15}$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? String(number) : null;
};
function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === value;
}
function validTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
}
function eventDay(value) {
  if (validDay(value)) return value;
  return validTimestamp(value) ? value.slice(0, 10) : null;
}
function trustedTeam(value) {
  if (!record(value)) return null;
  const team = BY_TEAM_ID.get(Number(idOf(value.id)));
  return team && value.abbreviation === team.abbreviation ? team : null;
}
const scoreOf = value => Number.isInteger(value) && value >= 0 && value <= 500 ? value : null;

function normalizeGame(value, date) {
  if (!record(value)) return null;
  const id = idOf(value.id), homeTeam = trustedTeam(value.homeTeam), awayTeam = trustedTeam(value.awayTeam);
  if (!id || !homeTeam || !awayTeam || homeTeam.id === awayTeam.id || eventDay(value.date) !== date || !['final', 'live', 'scheduled', 'unknown'].includes(value.status)) return null;
  // Scheduled/unknown zero placeholders are never facts or an inferred 0–0 score.
  const scored = value.status === 'final' || value.status === 'live';
  const homeScore = scored ? scoreOf(value.homeScore) : null, awayScore = scored ? scoreOf(value.awayScore) : null;
  return { id, date, status: value.status, homeTeam, awayTeam, homeScore, awayScore };
}

function describeGame(game) {
  const { homeTeam: home, awayTeam: away, homeScore, awayScore, status } = game;
  const matchup = `${away.fullName} at ${home.fullName}`;
  if (status === 'scheduled') return `${matchup}: scheduled; scores are unavailable.`;
  if (status === 'unknown') return `${matchup}: status unknown; scores are unavailable.`;
  if (homeScore === null || awayScore === null) return `${matchup}: ${status === 'live' ? 'live (partial)' : 'final'} status reported; a complete score is unavailable.`;
  if (status === 'live') return `${matchup}: live, partial score ${away.abbreviation} ${awayScore}, ${home.abbreviation} ${homeScore}; this is not a final result.`;
  if (homeScore === awayScore) return `${matchup}: provider reports a tied final score, ${away.abbreviation} ${awayScore}, ${home.abbreviation} ${homeScore}; no winner is inferred.`;
  const winner = homeScore > awayScore ? home : away;
  return `${matchup}: final score ${away.abbreviation} ${awayScore}, ${home.abbreviation} ${homeScore}. ${winner.fullName} won by ${Math.abs(homeScore - awayScore)} points; combined score ${homeScore + awayScore} points.`;
}

function prepare(result, date) {
  if (!validDay(date)) fail('invalid_date', 'Choose a valid calendar date.');
  if (!record(result) || !Array.isArray(result.data) || !record(result.provenance) || result.provenance.provider !== 'BALLDONTLIE' || result.provenance.dataMode !== 'provider' || !validTimestamp(result.provenance.fetchedAt)) fail('invalid_source', 'Verified provider game evidence is unavailable.');
  if (result.data.length > MAX_ROWS) fail('budget', 'The returned game evidence exceeds the ingestion budget.');
  const games = [], ids = new Set();
  let rejectedRows = 0, outsideDateRows = 0;
  for (const row of result.data) {
    if (record(row) && eventDay(row.date) && eventDay(row.date) !== date) { outsideDateRows++; continue; }
    const game = normalizeGame(row, date);
    if (!game || ids.has(game.id)) { rejectedRows++; continue; }
    ids.add(game.id); games.push(game);
  }
  const fetchedAt = result.provenance.fetchedAt;
  const indexedGames = games.slice(0, MAX_DOCUMENTS);
  const documents = indexedGames.map(game => {
    const source = {
      id: `bdl-game-${game.id}`,
      title: `${game.awayTeam.abbreviation} at ${game.homeTeam.abbreviation} — ${game.date}`,
      url: `${API}${game.id}`, asOf: fetchedAt, retrievedAt: fetchedAt, dataKind: 'connected',
      rights: { display: true, ai: true, reviewedBy: 'bdl-terms-2026-10-20' },
      coverage: ['matchups', 'stats'],
    };
    const facts = [];
    if (game.status === 'final' || game.status === 'live') {
      for (const side of ['home', 'away']) {
        const value = game[`${side}Score`];
        if (value !== null) facts.push({ id: `${side}-score`, label: `${game[`${side}Team`].fullName} ${game.status === 'live' ? 'live partial' : 'final'} score`, value, unit: 'points' });
      }
    }
    if (game.status === 'final' && game.homeScore !== null && game.awayScore !== null) {
      // Derived numbers are typed facts too, so future model output must match them.
      facts.push(
        { id: 'final-margin', label: 'Absolute final score margin (calculated)', value: Math.abs(game.homeScore - game.awayScore), unit: 'points' },
        { id: 'final-total', label: 'Combined final score (calculated)', value: game.homeScore + game.awayScore, unit: 'points' },
      );
    }
    return { source, text: `NBA game. Event date: ${game.date} (NBA Eastern calendar). ${describeGame(game)} Observation time (fetchedAt): ${fetchedAt}. Team names use current franchise labels. This record covers this game only; it provides no player statistics, injury report, season record, or forecast.`, facts };
  });
  return {
    games, indexedGames, documents, fetchedAt, rejectedRows, outsideDateRows,
    receivedRows: result.data.length,
    partial: result.pagination?.partial === true || result.pagination?.nextCursor != null,
    documentTruncated: games.length > MAX_DOCUMENTS,
    cacheHit: result.provenance.cache === true || result.provenance.cache === 'hit',
  };
}

/** Strict rag.mjs source schema, with URLs and permissions set only by this adapter. */
export function buildGameDocuments(result, { date } = {}) {
  return prepare(result, date).documents;
}

function tokenize(value) { return normalize(value).split(' ').filter(Boolean); }
function teamMatches(question) {
  const text = ` ${normalize(question)} `;
  // WAS is also an ordinary verb. Require its explicit uppercase abbreviation.
  return TEAMS.filter(team => team.aliases.some(alias => (alias !== 'was' || /\bWAS\b/.test(question)) && text.includes(` ${alias} `)));
}
function unknownQuestionWords(question, teams) {
  let text = ` ${normalize(question.replace(/\d{4}-\d{2}-\d{2}/g, ' '))} `;
  // Remove longest aliases first so a full team name cannot leave stray city words.
  const aliases = [...new Set(teams.flatMap(team => team.aliases))].sort((a, b) => b.length - a.length);
  for (const alias of aliases) text = text.split(` ${alias} `).join(' ');
  return tokenize(text).filter(word => !ALLOWED_WORDS.has(word));
}

/** Actual BM25 lexical ranking. It deliberately makes no embedding/semantic claim. */
function rankDocuments(question, documents) {
  const query = [...new Set(tokenize(question))];
  const tokens = documents.map(document => tokenize(document.text));
  const averageLength = tokens.reduce((sum, words) => sum + words.length, 0) / Math.max(tokens.length, 1);
  return documents.map((document, index) => {
    let score = 0;
    for (const term of query) {
      const frequency = tokens[index].filter(word => word === term).length;
      if (!frequency) continue;
      const documentFrequency = tokens.filter(words => words.includes(term)).length;
      const inverseFrequency = Math.log(1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
      score += inverseFrequency * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * tokens[index].length / averageLength));
    }
    return { document, score };
  }).sort((a, b) => b.score - a.score || a.document.source.id.localeCompare(b.document.source.id));
}

function dateMismatch(question, date, fetchedAt) {
  const dates = question.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  if (dates.some(day => day !== date || !validDay(day))) return true;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(fetchedAt)).map(part => [part.type, part.value]));
  const observationDay = `${parts.year}-${parts.month}-${parts.day}`;
  if (/\b(?:today|tonight|current|now)\b/i.test(question) && date !== observationDay) return true;
  for (const [pattern, offset] of [[/\b(?:yesterday|last\s+night)\b/i, -1], [/\btomorrow\b/i, 1]]) {
    if (!pattern.test(question)) continue;
    const expected = new Date(Date.parse(`${observationDay}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
    if (date !== expected) return true;
  }
  return false;
}

/**
 * Answer only the selected provider snapshot; no generated facts or model calls.
 * An unknown word/name is an abstention, rather than a guess about player stats.
 */
export function answerGameQuestion(input = {}) {
  const started = Date.now();
  let context;
  const metrics = {
    retrievalMethod: 'BM25 lexical', receivedRows: 0, validDateGames: 0,
    indexedDocuments: 0, retrievedDocuments: 0, shownGames: 0,
    rejectedRows: 0, outsideDateRows: 0, partialSlate: false,
    documentTruncated: false, summaryTruncated: false, cacheHit: false,
    embeddingCalls: 0, generationCalls: 0, modelCalls: 0, toolCalls: 0,
    deterministicCalculations: 0,
  };
  const finish = (status, answer, code, selected = []) => ({
    status, code, answer,
    citations: selected.map(({ document }) => ({
      id: document.source.id, title: document.source.title, url: document.source.url,
      kind: 'provider', asOf: document.source.asOf, fetchedAt: document.source.retrievedAt,
      eventDate: input?.date,
    })),
    evidence: selected.map(({ document }) => ({ id: `${document.source.id}:chunk-0`, text: document.text, sourceId: document.source.id })),
    metrics: { ...metrics, durationMs: Math.max(0, Date.now() - started) },
    mode: MODE, dataMode: 'provider', sourceScope: 'BALLDONTLIE games; selected date only',
  });
  if (!record(input) || typeof input.question !== 'string' || !input.question.trim() || input.question.length > MAX_QUESTION_CHARS || CONTROL.test(input.question)) return finish('refused', 'Enter a question within the question-size limit.', 'invalid_question');
  const question = input.question.trim();
  if (ATTACK.test(question)) return finish('refused', 'Instructions to reveal secrets or override evidence rules are refused.', 'prompt_injection');
  try { context = prepare(input.result, input.date); }
  catch (error) {
    const known = error instanceof LiveEvidenceError;
    return finish('refused', known ? error.message : 'Verified provider game evidence is unavailable.', known ? error.code : 'invalid_source');
  }
  Object.assign(metrics, {
    receivedRows: context.receivedRows, validDateGames: context.games.length,
    indexedDocuments: context.documents.length, rejectedRows: context.rejectedRows,
    outsideDateRows: context.outsideDateRows, partialSlate: context.partial,
    documentTruncated: context.documentTruncated, cacheHit: context.cacheHit,
  });
  if (AVAILABILITY.test(question)) return finish('insufficient', 'This games endpoint contains no verified injury or lineup report. Player availability and injury impact are unknown here.', 'injury_unavailable');
  if (FORECAST.test(question)) return finish('insufficient', 'This snapshot supports reported game results, not a validated win probability or future prediction. Daily accuracy and betting profitability cannot be established from it.', 'forecast_unavailable');
  if (UNSUPPORTED_STAT.test(question)) return finish('insufficient', 'This selected-date game snapshot has matchup and reported score fields only. Player statistics, season records, standings, and recent form are unavailable here.', 'stat_unavailable');
  if (dateMismatch(question, input.date, context.fetchedAt)) return finish('insufficient', `This snapshot covers ${input.date} only. Select the requested date to retrieve its games; observation time is ${context.fetchedAt}.`, 'date_scope');
  const teams = teamMatches(question);
  if (unknownQuestionWords(question, teams).length || (!teams.length && !GAME_INTENT.test(question))) return finish('insufficient', 'Ask about a returned NBA matchup, reported score, status, final margin, or combined final score for the selected date. Other names or facts are not supported by this evidence.', 'unsupported_question');
  let candidates = context.documents;
  if (input.gameId !== undefined && input.gameId !== null && input.gameId !== '') {
    const selectedId = idOf(input.gameId);
    candidates = candidates.filter(document => selectedId && document.source.id === `bdl-game-${selectedId}`);
    if (!candidates.length) return finish('insufficient', 'The selected game is not present in the indexed provider results for this date.', 'game_not_returned');
  }
  if (teams.length) {
    const requestedIds = new Set(teams.map(team => team.id));
    const gameById = new Map(context.indexedGames.map(game => [`bdl-game-${game.id}`, game]));
    // Every named team must belong to this one matchup, avoiding an unrelated hit.
    candidates = candidates.filter(document => {
      const game = gameById.get(document.source.id);
      return [...requestedIds].every(id => id === game.homeTeam.id || id === game.awayTeam.id);
    });
    if (!candidates.length) return finish('insufficient', 'No indexed returned game matches all the named teams within the selected date and game scope. No other matchup is substituted.', 'team_not_returned');
  }
  if (!candidates.length) return finish('insufficient', `No verified game records were returned for ${input.date}. This does not prove that no games were scheduled.`, 'no_games');
  const query = `${question} ${teams.map(team => team.fullName).join(' ')}`;
  const ranked = rankDocuments(query, candidates);
  const selected = ranked.slice(0, MAX_ANSWERS);
  metrics.retrievedDocuments = selected.length;
  metrics.shownGames = selected.length;
  metrics.summaryTruncated = candidates.length > selected.length;
  const gameById = new Map(context.indexedGames.map(game => [`bdl-game-${game.id}`, game]));
  const selectedGames = selected.map(({ document }) => gameById.get(document.source.id));
  metrics.deterministicCalculations = selectedGames.filter(game => game.status === 'final' && game.homeScore !== null && game.awayScore !== null && game.homeScore !== game.awayScore).length * 2;
  const count = /\bhow\s+many\s+(?:nba\s+)?(?:games|matchups)\b/i.test(question)
    ? `The snapshot contains ${candidates.length} indexed matching game records; this is a count of returned evidence, not a guarantee of the full schedule. ` : '';
  const coverage = [];
  if (metrics.summaryTruncated) coverage.push(`Showing ${selected.length} of ${candidates.length} indexed matching games`);
  if (context.documentTruncated) coverage.push(`evidence ingestion is capped at ${MAX_DOCUMENTS} of ${context.games.length} valid returned games`);
  if (context.partial) coverage.push('provider pagination is incomplete');
  if (context.rejectedRows) coverage.push(`${context.rejectedRows} invalid or duplicate returned records were omitted`);
  const limitations = coverage.length ? ` Coverage: ${coverage.join('; ')}. This summary is incomplete.` : '';
  const answer = `Selected event date: ${input.date}. ${count}${selectedGames.map(describeGame).join(' ')} Observed at ${context.fetchedAt}.${limitations}`;
  return finish('supported', answer, 'supported', selected);
}
