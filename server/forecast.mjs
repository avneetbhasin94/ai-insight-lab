/**
 * Offline, server-only NBA forecasting foundation. No provider/model calls,
 * persistence, or live forecast route. Passing tests is not performance evidence.
 */
export const FORECAST_VERSION = 'elo-fixed-home-v1';
export const FORECAST_DEFAULTS = Object.freeze({
  minTrainingGames: 200, kFactor: 20, homeAdvantage: 65, initialRating: 1500,
});
const MIN_TRAINING_GAMES = 50;
const MAX_GAMES = 20000;
const ELO_SCALE = 400;
const models = new WeakSet(), predictions = new WeakSet(), records = new WeakSet();
const settlements = new WeakMap();
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function invalid(message) { throw new TypeError(message); }
function shape(value, required, optional = []) {
  if (!record(value) || required.some(key => !own(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) invalid('Invalid forecast object shape.');
}
function id(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(value)) invalid('A bounded string ID is required.');
  return value;
}
function utc(value) {
  // Date.parse alone normalizes impossible dates and accepts ambiguous local time.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) invalid('An explicit UTC timestamp is required.');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value.replace(/Z$/u, value.includes('.') ? 'Z' : '.000Z')) invalid('Invalid UTC timestamp.');
  return ms;
}
function boundedNumber(value, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) invalid('Invalid numerical forecast input.');
  return value;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function evidenceIds(value) {
  if (!Array.isArray(value) || !value.length || value.length > 100 || new Set(value).size !== value.length) invalid('Unique evidence IDs are required.');
  return [...value].map(id); // Iteration exposes sparse holes as invalid undefined IDs.
}
function provenance(value, knownAt) {
  shape(value, ['kind', 'source', 'retrievedAt']);
  if (!['synthetic', 'connected'].includes(value.kind) || typeof value.source !== 'string' || !value.source.trim() || value.source.length > 200 || /[\u0000-\u001f\u007f]/u.test(value.source)) invalid('Invalid source provenance.');
  // A current retrieval must never masquerade as a historical availability snapshot.
  if (utc(value.retrievedAt) !== utc(knownAt)) invalid('Provenance retrieval must equal the retained availability timestamp.');
  return { kind: value.kind, source: value.source.trim(), retrievedAt: value.retrievedAt };
}
function game(value, final) {
  const common = ['id', 'homeTeamId', 'awayTeamId', 'tipoffAt', 'knownAt', 'status', 'evidenceIds', 'provenance'];
  shape(value, final ? [...common, 'finalizedAt', 'homeScore', 'awayScore'] : common);
  const result = {
    id: id(value.id), homeTeamId: id(value.homeTeamId), awayTeamId: id(value.awayTeamId),
    tipoffAt: value.tipoffAt, knownAt: value.knownAt, status: value.status,
    evidenceIds: evidenceIds(value.evidenceIds), provenance: provenance(value.provenance, value.knownAt),
  };
  const tip = utc(value.tipoffAt), known = utc(value.knownAt);
  if (result.homeTeamId === result.awayTeamId || value.status !== (final ? 'final' : 'scheduled')) invalid('A distinct-team game with the required lifecycle is required.');
  if (final) {
    const finished = utc(value.finalizedAt);
    if (finished <= tip || known < finished) invalid('A final result must become available after tip-off and completion.');
    const homeScore = boundedNumber(value.homeScore, 0, 500, true), awayScore = boundedNumber(value.awayScore, 0, 500, true);
    if (homeScore === awayScore) invalid('Tied finals are invalid NBA training or evaluation outcomes.');
    Object.assign(result, { finalizedAt: value.finalizedAt, homeScore, awayScore });
  } else if (known >= tip) invalid('A pregame schedule snapshot must exist before tip-off.');
  return result;
}
function collection(value, { nonempty = false } = {}) {
  if (!Array.isArray(value) || value.length > MAX_GAMES || (nonempty && !value.length)) invalid('A bounded game array is required.');
}
function settings(options) {
  return {
    minTrainingGames: boundedNumber(own(options, 'minTrainingGames') ? options.minTrainingGames : FORECAST_DEFAULTS.minTrainingGames, MIN_TRAINING_GAMES, MAX_GAMES, true),
    kFactor: boundedNumber(own(options, 'kFactor') ? options.kFactor : FORECAST_DEFAULTS.kFactor, 1, 64),
    homeAdvantage: boundedNumber(own(options, 'homeAdvantage') ? options.homeAdvantage : FORECAST_DEFAULTS.homeAdvantage, 0, 200),
    initialRating: FORECAST_DEFAULTS.initialRating,
  };
}
function probability(homeRating, awayRating, homeAdvantage) {
  return 1 / (1 + 10 ** ((awayRating - homeRating - homeAdvantage) / ELO_SCALE));
}
function addResult(state, final) {
  const initial = state.settings.initialRating;
  const home = state.ratings.get(final.homeTeamId) ?? { rating: initial, games: 0 };
  const away = state.ratings.get(final.awayTeamId) ?? { rating: initial, games: 0 };
  const actual = Number(final.homeScore > final.awayScore);
  // Zero-sum Elo: the same residual adds to the home rating and subtracts from away.
  // The fixed home advantage is an explicit assumption, not a learned injury effect.
  const delta = state.settings.kFactor * (actual - probability(home.rating, away.rating, state.settings.homeAdvantage));
  state.ratings.set(final.homeTeamId, { rating: home.rating + delta, games: home.games + 1 });
  state.ratings.set(final.awayTeamId, { rating: away.rating - delta, games: away.games + 1 });
  state.finals.push(final);
}
function chronological(a, b) {
  return utc(a.knownAt) - utc(b.knownAt) || utc(a.finalizedAt) - utc(b.finalizedAt) || a.id.localeCompare(b.id);
}
function dataKind(items) {
  const kinds = new Set(items.map(item => item.provenance.kind));
  return kinds.size === 1 ? [...kinds][0] : 'mixed';
}
function evidence(items) {
  return items.map(item => ({ gameId: item.id, evidenceIds: [...item.evidenceIds], provenance: { ...item.provenance } }));
}
function snapshot(state, cutoffAt) {
  const result = freeze({
    schemaVersion: 1, modelVersion: FORECAST_VERSION, trainedThroughAt: cutoffAt,
    settings: { ...state.settings }, trainingGameCount: state.finals.length,
    trainingGameIds: state.finals.map(item => item.id),
    ratings: [...state.ratings].sort(([a], [b]) => a.localeCompare(b)).map(([teamId, values]) => ({ teamId, ...values })),
    trainingHomeWinRate: state.finals.filter(item => item.homeScore > item.awayScore).length / state.finals.length,
    evidence: evidence(state.finals), dataKind: dataKind(state.finals),
    probabilityStatus: 'raw-uncalibrated', validated: false,
  });
  models.add(result);
  return result;
}

/** Fit exclusively on final results actually retained by cutoffAt, in availability order. */
export function trainEloModel(options) {
  shape(options, ['games', 'cutoffAt'], ['minTrainingGames', 'kFactor', 'homeAdvantage']);
  const cutoff = utc(options.cutoffAt), configuration = settings(options);
  collection(options.games);
  const finals = options.games.map(value => game(value, true));
  if (finals.length < configuration.minTrainingGames) invalid(`At least ${configuration.minTrainingGames} training games are required; this guard does not establish validation.`);
  if (new Set(finals.map(item => item.id)).size !== finals.length) invalid('Duplicate training game ID.');
  if (finals.some(item => utc(item.knownAt) > cutoff)) invalid('Training includes a result unavailable at the cutoff.');
  const state = { ratings: new Map(), finals: [], settings: configuration };
  for (const final of finals.sort(chronological)) addResult(state, final);
  return snapshot(state, options.cutoffAt);
}

/** Model/record identities are local-runtime objects; serialized imports need a future validator. */
export function predictPregame(options) {
  shape(options, ['model', 'game', 'createdAt']);
  if (!models.has(options.model)) invalid('Use a model returned by trainEloModel in this runtime.');
  const model = options.model, scheduled = game(options.game, false), at = utc(options.createdAt);
  if (at < utc(model.trainedThroughAt) || at < utc(scheduled.knownAt) || at >= utc(scheduled.tipoffAt)) invalid('Prediction must follow available inputs and precede tip-off strictly.');
  if (model.trainingGameIds.includes(scheduled.id)) invalid('A training game cannot be predicted as a future game.');
  const home = model.ratings.find(item => item.teamId === scheduled.homeTeamId), away = model.ratings.find(item => item.teamId === scheduled.awayTeamId);
  if (!home || !away) invalid('Both teams require an observed training rating.');
  const homeWinProbability = probability(home.rating, away.rating, model.settings.homeAdvantage);
  const sources = [...model.evidence, ...evidence([scheduled])];
  const result = freeze({
    schemaVersion: 1, modelVersion: model.modelVersion, createdAt: options.createdAt,
    game: { id: scheduled.id, homeTeamId: scheduled.homeTeamId, awayTeamId: scheduled.awayTeamId, tipoffAt: scheduled.tipoffAt },
    homeWinProbability, awayWinProbability: 1 - homeWinProbability,
    predictedWinnerTeamId: homeWinProbability >= 0.5 ? scheduled.homeTeamId : scheduled.awayTeamId,
    probabilityStatus: 'raw-uncalibrated', validated: false,
    dataKind: dataKind(sources),
    training: { cutoffAt: model.trainedThroughAt, gameCount: model.trainingGameCount, gameIds: [...model.trainingGameIds], settings: { ...model.settings } },
    inputs: {
      used: { homeElo: home.rating, awayElo: away.rating, homeRatingGames: home.games, awayRatingGames: away.games, fixedHomeAdvantage: model.settings.homeAdvantage, eloScale: ELO_SCALE },
      excluded: [
        { factor: 'injuries', reason: 'No verified licensed injury snapshot is connected; no injury weights are used.' },
        { factor: 'matchupStats', reason: 'No verified pregame efficiency, rest, lineup, or player-stat features are ingested.' },
        { factor: 'odds', reason: 'No odds feed or betting return calculation is connected.' },
      ],
      evidenceIds: [...new Set(sources.flatMap(item => item.evidenceIds))].sort(),
      provenance: sources,
    },
    limitations: ['Raw Elo probability is not calibrated or validated.', 'Fixed home advantage and K factor are assumptions.', 'Outcome accuracy does not establish betting profitability.'],
  });
  predictions.add(result);
  return result;
}

function scoreMetrics(rows, key) {
  const bins = Array.from({ length: 10 }, (_, index) => ({ lower: index / 10, upper: (index + 1) / 10, count: 0, sumProbability: 0, homeWins: 0 }));
  let correct = 0, brier = 0, loss = 0;
  for (const row of rows) {
    const p = row[key], y = row.homeWon;
    correct += Number(Number(p >= 0.5) === y);
    brier += (p - y) ** 2;
    // Only logarithms are clipped; the exposed probability and Brier score are exact.
    const clipped = Math.max(1e-15, Math.min(1 - 1e-15, p));
    loss -= y * Math.log(clipped) + (1 - y) * Math.log(1 - clipped);
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.count++; bin.sumProbability += p; bin.homeWins += y;
  }
  const sampleCount = rows.length;
  const calibrationBins = bins.map(bin => ({
    lower: bin.lower, upper: bin.upper, includesUpper: bin.upper === 1, count: bin.count,
    meanProbability: bin.count ? bin.sumProbability / bin.count : null,
    observedHomeWinRate: bin.count ? bin.homeWins / bin.count : null,
  }));
  return {
    sampleCount, correct, accuracy: correct / sampleCount, brierScore: brier / sampleCount, logLoss: loss / sampleCount,
    expectedCalibrationError: calibrationBins.reduce((sum, bin) => sum + (bin.count ? bin.count / sampleCount * Math.abs(bin.meanProbability - bin.observedHomeWinRate) : 0), 0),
    calibrationBins,
  };
}

/**
 * Replay forecasts at explicit pregame instants. A prior evaluation final can
 * update ratings only when its retained snapshot was available by that instant.
 * The simple home-win-rate comparator stays fitted to initial training only.
 */
export function evaluateWalkForward(options) {
  shape(options, ['trainingGames', 'evaluationGames', 'trainingCutoffAt'], ['minTrainingGames', 'kFactor', 'homeAdvantage']);
  collection(options.evaluationGames, { nonempty: true });
  const model = trainEloModel({ games: options.trainingGames, cutoffAt: options.trainingCutoffAt, ...Object.fromEntries(['minTrainingGames', 'kFactor', 'homeAdvantage'].filter(key => own(options, key)).map(key => [key, options[key]])) });
  const samples = options.evaluationGames.map(value => {
    shape(value, ['game', 'result', 'predictionAt']);
    const scheduled = game(value.game, false), final = game(value.result, true), at = utc(value.predictionAt);
    if (['id', 'homeTeamId', 'awayTeamId', 'tipoffAt'].some(key => scheduled[key] !== final[key])) invalid('Evaluation schedule and final result do not identify the same game.');
    if (at < utc(options.trainingCutoffAt) || at < utc(scheduled.knownAt) || at >= utc(scheduled.tipoffAt)) invalid('Invalid evaluation forecast instant or training cutoff.');
    return { game: scheduled, result: final, predictionAt: value.predictionAt };
  }).sort((a, b) => utc(a.predictionAt) - utc(b.predictionAt) || a.game.id.localeCompare(b.game.id));
  const trainIds = new Set(model.trainingGameIds), evalIds = samples.map(item => item.game.id);
  if (new Set(evalIds).size !== evalIds.length || evalIds.some(value => trainIds.has(value))) invalid('Training and evaluation IDs must be unique and disjoint.');
  const state = { ratings: new Map(model.ratings.map(({ teamId, ...values }) => [teamId, { ...values }])), finals: options.trainingGames.map(value => game(value, true)).sort(chronological), settings: { ...model.settings } };
  const available = samples.map(item => item.result).sort(chronological);
  let cursor = 0;
  const rows = samples.map(sample => {
    while (cursor < available.length && utc(available[cursor].knownAt) <= utc(sample.predictionAt)) addResult(state, available[cursor++]);
    const prediction = predictPregame({ model: snapshot(state, sample.predictionAt), game: sample.game, createdAt: sample.predictionAt });
    const homeWon = Number(sample.result.homeScore > sample.result.awayScore);
    return {
      gameId: sample.game.id, createdAt: sample.predictionAt, tipoffAt: sample.game.tipoffAt,
      homeWinProbability: prediction.homeWinProbability, homeWinRateBaseline: model.trainingHomeWinRate,
      homeWon, correct: Number(prediction.predictedWinnerTeamId === (homeWon ? sample.game.homeTeamId : sample.game.awayTeamId)),
      resultKnownAt: sample.result.knownAt, trainingGameCount: prediction.training.gameCount,
      prediction,
    };
  });
  return freeze({
    schemaVersion: 1, modelVersion: FORECAST_VERSION, mode: 'offline-walk-forward',
    initialTrainingGameCount: model.trainingGameCount, evaluationGameCount: rows.length,
    trainingCutoffAt: options.trainingCutoffAt, evaluationStartsAt: samples[0].predictionAt, evaluationEndsAt: samples.at(-1).predictionAt,
    dataKind: dataKind([...state.finals, ...samples.map(item => item.result), ...samples.map(item => item.game)]),
    probabilityStatus: 'raw-uncalibrated', validated: false,
    metrics: { elo: scoreMetrics(rows, 'homeWinProbability'), homeWinRateBaseline: scoreMetrics(rows, 'homeWinRateBaseline') },
    baseline: { description: 'Constant home-win probability fitted exclusively to initial training games.', homeWinProbability: model.trainingHomeWinRate, trainingGameCount: model.trainingGameCount },
    rows, limitations: ['Descriptive held-out metrics do not establish future accuracy or profit.', 'Calibration bins measure reliability; they do not calibrate the model.', 'Historical input timestamps must come from retained snapshots, not invented availability dates.'],
  });
}

/** Freeze a forecast before tip-off. This is not a durable, tamper-resistant ledger. */
export function freezePredictionRecord(options) {
  shape(options, ['predictionId', 'prediction'], ['createdAt']);
  const prediction = options.prediction;
  if (!predictions.has(prediction)) invalid('Use a prediction returned by predictPregame in this runtime.');
  const createdAt = own(options, 'createdAt') ? options.createdAt : prediction.createdAt;
  if (utc(createdAt) !== utc(prediction.createdAt) || utc(createdAt) >= utc(prediction.game.tipoffAt)) invalid('A forecast timestamp cannot be changed or reach tip-off.');
  const result = freeze({
    schemaVersion: 1, recordType: 'prediction', predictionId: id(options.predictionId),
    gameId: prediction.game.id, modelVersion: prediction.modelVersion,
    createdAt, tipoffAt: prediction.game.tipoffAt,
    forecast: prediction, integrity: 'in-memory-freeze-only',
  });
  records.add(result);
  return result;
}

/** Return a separate appendable outcome event; never overwrite a forecast or omit a loss. */
export function settlePredictionRecord(options) {
  shape(options, ['prediction', 'outcome', 'settledAt']);
  const prediction = options.prediction;
  if (!records.has(prediction)) invalid('Use a frozen prediction record from this runtime.');
  if (settlements.has(prediction)) invalid('This prediction already has an in-memory settlement event.');
  const final = game(options.outcome, true), settled = utc(options.settledAt);
  if (['id', 'homeTeamId', 'awayTeamId', 'tipoffAt'].some(key => prediction.forecast.game[key] !== final[key])) invalid('The outcome does not match the prediction game.');
  if (settled < utc(final.knownAt)) invalid('Settlement precedes availability of the final result.');
  const homeWon = Number(final.homeScore > final.awayScore);
  const result = freeze({
    schemaVersion: 1, recordType: 'outcome', outcomeId: `${prediction.predictionId}:outcome`,
    predictionId: prediction.predictionId, gameId: prediction.gameId, settledAt: options.settledAt,
    homeScore: final.homeScore, awayScore: final.awayScore,
    winnerTeamId: homeWon ? final.homeTeamId : final.awayTeamId,
    correct: prediction.forecast.predictedWinnerTeamId === (homeWon ? final.homeTeamId : final.awayTeamId),
    brierScore: (prediction.forecast.homeWinProbability - homeWon) ** 2,
    evidenceIds: [...final.evidenceIds], provenance: { ...final.provenance },
    finalizedAt: final.finalizedAt, resultKnownAt: final.knownAt,
    integrity: 'in-memory-freeze-only',
  });
  settlements.set(prediction, result);
  return result;
}
