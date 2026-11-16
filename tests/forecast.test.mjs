import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORECAST_DEFAULTS, FORECAST_VERSION, trainEloModel, predictPregame,
  evaluateWalkForward, freezePredictionRecord, settlePredictionRecord,
} from '../server/forecast.mjs';

// Fabricated games exercise temporal/math invariants only. Their hit rates say
// nothing about NBA outcomes. No provider, key, network, or paid model is used.
const START = Date.parse('2025-01-01T00:00:00.000Z');
const HOUR = 3600000, STEP = 4 * HOUR;
const iso = value => new Date(value).toISOString();
const tip = index => START + index * STEP;
const provenance = knownAt => ({ kind: 'synthetic', source: 'Fabricated temporal unit-test fixture', retrievedAt: knownAt });
function scheduled(index, changes = {}) {
  const knownAt = iso(tip(index) - 3 * HOUR);
  return {
    id: `synthetic-game-${index}`, homeTeamId: 'BOS', awayTeamId: 'NYK',
    tipoffAt: iso(tip(index)), knownAt, status: 'scheduled',
    evidenceIds: [`synthetic-schedule-${index}`], provenance: provenance(knownAt), ...changes,
  };
}
function final(index, changes = {}) {
  const knownAt = iso(tip(index) + 2 * HOUR + 300000);
  return {
    ...scheduled(index), status: 'final', finalizedAt: iso(tip(index) + 2 * HOUR), knownAt,
    homeScore: index % 5 < 3 ? 110 : 90, awayScore: 100,
    evidenceIds: [`synthetic-final-${index}`], provenance: provenance(knownAt), ...changes,
  };
}
const training = () => Array.from({ length: 200 }, (_, index) => final(index));
const cutoffAt = iso(tip(200) - HOUR);
const fit = changes => trainEloModel({ games: training(), cutoffAt, ...changes });
const forecast = (model = fit(), changes = {}) => predictPregame({ model, game: scheduled(200), createdAt: iso(tip(200) - HOUR / 2), ...changes });
const sample = (index, resultChanges = {}) => ({ game: scheduled(index), result: final(index, resultChanges), predictionAt: iso(tip(index) - HOUR / 2) });
const evaluate = changes => evaluateWalkForward({ trainingGames: training(), evaluationGames: [sample(200), sample(201), sample(202), sample(203)], trainingCutoffAt: cutoffAt, ...changes });

test('Elo learns deterministic ratings from chronological final results and conserves total rating', () => {
  const model = fit(), reversed = fit({ games: training().reverse() });
  assert.deepEqual(model, reversed);
  assert.equal(model.modelVersion, FORECAST_VERSION);
  assert.equal(model.trainingGameCount, 200);
  assert.equal(model.trainingHomeWinRate, 0.6);
  assert.equal(model.ratings.reduce((sum, item) => sum + item.rating, 0), 3000);
  assert.notEqual(model.ratings.find(item => item.teamId === 'BOS').rating, 1500);
  const before = fit({ games: training().slice(0, 50), minTrainingGames: 50 });
  const after = fit({ games: training().slice(0, 51), minTrainingGames: 50 });
  const home = before.ratings.find(item => item.teamId === 'BOS').rating;
  const away = before.ratings.find(item => item.teamId === 'NYK').rating;
  const expected = home + 20 * (1 - 1 / (1 + 10 ** ((away - home - 65) / 400)));
  assert.equal(after.ratings.find(item => item.teamId === 'BOS').rating, expected);
  assert.equal(model.probabilityStatus, 'raw-uncalibrated');
  assert.equal(model.validated, false);
  assert.equal(model.dataKind, 'synthetic');
  assert.equal(FORECAST_DEFAULTS.minTrainingGames, 200);
  assert.ok(Object.isFrozen(model.ratings[0]));
});

test('training minimum defaults to 200; a configurable floor is a guard, not validation', () => {
  assert.throws(() => fit({ games: training().slice(0, 199) }), /200 training games/);
  const model = fit({ games: training().slice(0, 50), minTrainingGames: 50 });
  assert.equal(model.trainingGameCount, 50);
  assert.equal(model.validated, false);
  for (const minTrainingGames of [0, 20, 49, 50.5, 20001, '200', NaN, Infinity, null, undefined]) assert.throws(() => fit({ minTrainingGames }), TypeError);
});

test('training refuses unavailable finals, invalid lifecycle, ties and duplicate IDs', () => {
  const games = training();
  const future = iso(tip(200) + HOUR);
  assert.throws(() => fit({ games: [...games.slice(0, 199), final(199, { knownAt: future, provenance: provenance(future) })] }), /unavailable/);
  assert.throws(() => fit({ games: [...games.slice(0, 199), scheduled(199)] }), TypeError);
  assert.throws(() => fit({ games: [...games.slice(0, 199), final(199, { homeScore: 100, awayScore: 100 })] }), /Tied/);
  assert.throws(() => fit({ games: [...games.slice(0, 199), games[0]] }), /Duplicate/);
  assert.throws(() => fit({ games: [...games.slice(0, 199), final(199, { finalizedAt: iso(tip(199)) })] }), TypeError);
  const premature = iso(tip(199) + HOUR);
  assert.throws(() => fit({ games: [...games.slice(0, 199), final(199, { knownAt: premature, provenance: provenance(premature) })] }), TypeError);
});

test('availability timestamps and provenance must describe the same retained snapshot', () => {
  const bad = final(199);
  bad.provenance.retrievedAt = iso(tip(199) + 3 * HOUR);
  assert.throws(() => fit({ games: [...training().slice(0, 199), bad] }), /retained availability/);
  for (const value of ['2025-01-01', '2025-02-30T12:00:00Z', '2025-01-01T12:00:00+00:00', '2025-01-01T12:00:00', [], NaN, null]) assert.throws(() => fit({ cutoffAt: value }), TypeError);
  assert.equal(fit({ cutoffAt: cutoffAt.replace('.000Z', 'Z') }).trainingGameCount, 200);
});

test('invalid arrays, numeric types, scores, IDs and evidence fail closed', () => {
  for (const value of [null, [], NaN, {}, 'games']) assert.throws(() => trainEloModel(value), TypeError);
  for (const value of [null, {}, NaN, 'games']) assert.throws(() => fit({ games: value }), TypeError);
  for (const key of ['homeScore', 'awayScore']) for (const value of [NaN, Infinity, -1, 501, 10.5, '100', null, []]) {
    assert.throws(() => fit({ games: [...training().slice(0, 199), final(199, { [key]: value })] }), TypeError);
  }
  for (const kFactor of [NaN, Infinity, 0, 65, [], null, '20']) assert.throws(() => fit({ kFactor }), TypeError);
  for (const homeAdvantage of [NaN, -1, 201, [], null, '65']) assert.throws(() => fit({ homeAdvantage }), TypeError);
  for (const changes of [{ id: [] }, { homeTeamId: 'NYK' }, { evidenceIds: [] }, { evidenceIds: Array(1) }, { evidenceIds: ['same', 'same'] }, { evidenceIds: [NaN] }, { unexpectedFeature: 2 }]) {
    assert.throws(() => fit({ games: [...training().slice(0, 199), final(199, changes)] }), TypeError);
  }
});

test('prediction exposes exact used factors, source IDs, uncalibrated status and excluded injuries', () => {
  const model = fit(), prediction = forecast(model), used = prediction.inputs.used;
  const expected = 1 / (1 + 10 ** ((used.awayElo - used.homeElo - used.fixedHomeAdvantage) / used.eloScale));
  assert.equal(prediction.homeWinProbability, expected);
  assert.equal(prediction.homeWinProbability + prediction.awayWinProbability, 1);
  assert.equal(prediction.inputs.used.fixedHomeAdvantage, 65);
  assert.equal(prediction.inputs.used.homeRatingGames, 200);
  assert.equal(prediction.inputs.used.awayRatingGames, 200);
  assert.equal(prediction.inputs.excluded.find(item => item.factor === 'injuries').reason.includes('no injury weights'), true);
  assert.equal(prediction.inputs.used.injuries, undefined);
  assert.ok(prediction.inputs.evidenceIds.includes('synthetic-schedule-200'));
  assert.ok(prediction.inputs.evidenceIds.includes('synthetic-final-0'));
  assert.equal(prediction.inputs.provenance.length, 201);
  assert.equal(prediction.training.gameCount, 200);
  assert.equal(prediction.validated, false);
  assert.equal(prediction.dataKind, 'synthetic');
  assert.deepEqual(prediction, forecast(model));
});

test('fixed home advantage is disclosed and can be removed, without being learned or called calibrated', () => {
  const model = fit({ homeAdvantage: 0 });
  const prediction = forecast(model);
  assert.equal(prediction.inputs.used.fixedHomeAdvantage, 0);
  assert.equal(prediction.training.settings.homeAdvantage, 0);
  assert.equal(prediction.probabilityStatus, 'raw-uncalibrated');
});

test('prediction rejects at/after tipoff, inputs unavailable at creation and ambiguous timestamps', () => {
  const model = fit();
  for (const createdAt of [iso(tip(200)), iso(tip(200) + 1), iso(tip(200) - 2 * HOUR), '2025-01-01', null, [], NaN]) assert.throws(() => forecast(model, { createdAt }), TypeError);
  const knownAt = iso(tip(200) - HOUR / 4);
  assert.throws(() => forecast(model, { game: scheduled(200, { knownAt, provenance: provenance(knownAt) }) }), TypeError);
  const laterModel = fit({ cutoffAt: iso(tip(200) - 1000) });
  assert.throws(() => forecast(laterModel), /available inputs/);
});

test('scores, final lifecycle, untrained teams and in-sample games cannot become pregame inputs', () => {
  const model = fit();
  for (const changes of [{ homeScore: 0 }, { status: 'final' }, { finalizedAt: iso(tip(200) + HOUR) }, { injuries: [] }, { awayTeamId: 'UNKNOWN' }, { id: 'synthetic-game-0' }]) {
    assert.throws(() => forecast(model, { game: scheduled(200, changes) }), TypeError);
  }
  assert.throws(() => forecast(structuredClone(model)), /this runtime/);
  assert.throws(() => predictPregame([]), TypeError);
});

test('walk-forward retains every prediction including losses and updates only after known finals', () => {
  const result = evaluate();
  assert.equal(result.rows.length, 4);
  assert.deepEqual(result.rows.map(row => row.trainingGameCount), [200, 201, 202, 203]);
  assert.ok(result.rows.some(row => row.correct === 0));
  assert.ok(result.rows.some(row => row.correct === 1));
  assert.equal(result.metrics.elo.sampleCount, 4);
  assert.equal(result.validated, false);
  assert.equal(result.probabilityStatus, 'raw-uncalibrated');
  assert.equal(result.dataKind, 'synthetic');
  assert.equal(result.metrics.elo.calibrationBins.reduce((sum, bin) => sum + bin.count, 0), 4);
  for (const row of result.rows) assert.ok(Date.parse(row.createdAt) < Date.parse(row.tipoffAt));
});

test('late-arriving results cannot change forecasts that preceded availability', () => {
  const knownAt = iso(tip(202) - HOUR);
  const result = evaluate({ evaluationGames: [sample(200, { knownAt, provenance: provenance(knownAt) }), sample(201), sample(202)] });
  assert.deepEqual(result.rows.map(row => row.trainingGameCount), [200, 200, 202]);
  assert.equal(result.rows[0].homeWinProbability, result.rows[1].homeWinProbability);
  assert.deepEqual(result, evaluate({ evaluationGames: [sample(202), sample(201), sample(200, { knownAt, provenance: provenance(knownAt) })] }));
});

test('changing a future score cannot change an earlier forecast; once known it changes later ratings', () => {
  const normal = evaluate(), changed = evaluate({ evaluationGames: [sample(200, { homeScore: 80 }), sample(201), sample(202), sample(203)] });
  assert.equal(normal.rows[0].homeWinProbability, changed.rows[0].homeWinProbability);
  assert.notEqual(normal.rows[1].homeWinProbability, changed.rows[1].homeWinProbability);
  assert.equal(normal.baseline.homeWinProbability, changed.baseline.homeWinProbability);
});

test('walk-forward refuses train/evaluation overlap, duplicate evaluation IDs and mismatched results', () => {
  const overlap = training(); overlap[199] = final(199, { id: 'synthetic-game-200' });
  assert.throws(() => evaluate({ trainingGames: overlap }), /disjoint/);
  assert.throws(() => evaluate({ evaluationGames: [sample(200), sample(200)] }), /disjoint/);
  assert.throws(() => evaluate({ evaluationGames: [{ ...sample(200), result: final(201) }] }), /same game/);
  assert.throws(() => evaluate({ evaluationGames: [sample(200, { homeScore: 100 })] }), /Tied/);
  for (const evaluationGames of [[], null, {}, NaN, [null], [[]]]) assert.throws(() => evaluate({ evaluationGames }), TypeError);
});

test('every evaluation timestamp must follow training cutoff and available schedule, strictly before tip', () => {
  for (const predictionAt of [iso(tip(200)), iso(tip(200) + 1), iso(tip(200) - 2 * HOUR), null, []]) {
    assert.throws(() => evaluate({ evaluationGames: [{ ...sample(200), predictionAt }] }), TypeError);
  }
  const knownAt = iso(tip(200) - HOUR / 4);
  assert.throws(() => evaluate({ evaluationGames: [{ ...sample(200), game: scheduled(200, { knownAt, provenance: provenance(knownAt) }) }] }), TypeError);
});

test('accuracy, Brier, log loss and reliability bins agree with independently recomputed values', () => {
  const result = evaluate(), rows = result.rows, metrics = result.metrics.elo;
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.equal(metrics.accuracy, mean(rows.map(row => row.correct)));
  assert.equal(metrics.brierScore, mean(rows.map(row => (row.homeWinProbability - row.homeWon) ** 2)));
  assert.equal(metrics.logLoss, mean(rows.map(row => -Math.log(row.homeWon ? row.homeWinProbability : 1 - row.homeWinProbability))));
  const nonempty = metrics.calibrationBins.filter(bin => bin.count);
  assert.ok(nonempty.every(bin => bin.meanProbability >= bin.lower && bin.meanProbability <= bin.upper));
  assert.equal(metrics.expectedCalibrationError, nonempty.reduce((sum, bin) => sum + bin.count / rows.length * Math.abs(bin.meanProbability - bin.observedHomeWinRate), 0));
  assert.ok(metrics.calibrationBins.filter(bin => !bin.count).every(bin => bin.meanProbability === null && bin.observedHomeWinRate === null));
});

test('home-win-rate comparator is fitted only on initial training and retains extreme misses', () => {
  const allHome = training().map(item => ({ ...item, homeScore: 110, awayScore: 90 }));
  const result = evaluate({ trainingGames: allHome, evaluationGames: [sample(200, { homeScore: 80 })] });
  assert.equal(result.baseline.homeWinProbability, 1);
  assert.equal(result.baseline.trainingGameCount, 200);
  assert.equal(result.rows[0].homeWinRateBaseline, 1);
  assert.equal(result.metrics.homeWinRateBaseline.accuracy, 0);
  assert.equal(result.metrics.homeWinRateBaseline.brierScore, 1);
  assert.ok(Number.isFinite(result.metrics.homeWinRateBaseline.logLoss));
  const finalBin = result.metrics.homeWinRateBaseline.calibrationBins.at(-1);
  assert.equal(finalBin.count, 1); assert.equal(finalBin.includesUpper, true);
  assert.equal(finalBin.meanProbability, 1); assert.equal(finalBin.observedHomeWinRate, 0);
});

test('forecast records freeze timestamp, factors and provenance deeply without changing source objects', () => {
  const inputGame = scheduled(200), model = fit();
  const prediction = forecast(model, { game: inputGame });
  const frozen = freezePredictionRecord({ predictionId: 'synthetic-prediction-200', prediction });
  inputGame.provenance.source = 'mutated input';
  assert.equal(frozen.forecast.inputs.provenance.at(-1).provenance.source, 'Fabricated temporal unit-test fixture');
  assert.equal(frozen.createdAt, prediction.createdAt);
  assert.equal(frozen.integrity, 'in-memory-freeze-only');
  for (const change of [() => { frozen.createdAt = frozen.tipoffAt; }, () => { frozen.forecast.inputs.used.homeElo = 9999; }, () => { frozen.forecast.inputs.evidenceIds.push('forged'); }, () => { frozen.forecast.inputs.provenance[0].provenance.kind = 'connected'; }]) assert.throws(change, TypeError);
  assert.throws(() => freezePredictionRecord({ predictionId: 'p', prediction, createdAt: prediction.game.tipoffAt }), TypeError);
  assert.throws(() => freezePredictionRecord({ predictionId: 'p', prediction, createdAt: iso(Date.parse(prediction.createdAt) - 1) }), TypeError);
  assert.throws(() => freezePredictionRecord({ predictionId: 'p', prediction, createdAt: null }), TypeError);
  assert.throws(() => freezePredictionRecord({ predictionId: 'p', prediction: structuredClone(prediction) }), TypeError);
  assert.throws(() => freezePredictionRecord([]), TypeError);
});

test('settlement emits a separate loss event and preserves the frozen forecast', () => {
  const prediction = freezePredictionRecord({ predictionId: 'loss-200', prediction: forecast() });
  const before = JSON.stringify(prediction);
  const outcome = final(200, { homeScore: 80 });
  const event = settlePredictionRecord({ prediction, outcome, settledAt: iso(tip(200) + 3 * HOUR) });
  assert.equal(event.recordType, 'outcome');
  assert.equal(event.predictionId, prediction.predictionId);
  assert.equal(event.correct, false);
  assert.equal(event.winnerTeamId, 'NYK');
  assert.equal(event.brierScore, prediction.forecast.homeWinProbability ** 2);
  assert.equal(JSON.stringify(prediction), before);
  assert.equal(prediction.correct, undefined);
  assert.ok(Object.isFrozen(event.provenance));
  assert.throws(() => { event.correct = true; }, TypeError);
  assert.throws(() => settlePredictionRecord({ prediction, outcome, settledAt: iso(tip(200) + 4 * HOUR) }), /already/);
});

test('settlement rejects premature timestamps, wrong games, ties and forged records', () => {
  const prediction = freezePredictionRecord({ predictionId: 'settle-200', prediction: forecast() });
  const settledAt = iso(tip(200) + 3 * HOUR);
  assert.throws(() => settlePredictionRecord({ prediction, outcome: final(200), settledAt: iso(tip(200) + HOUR) }), /availability/);
  assert.throws(() => settlePredictionRecord({ prediction, outcome: final(201), settledAt }), /match/);
  assert.throws(() => settlePredictionRecord({ prediction, outcome: final(200, { homeScore: 100 }), settledAt }), /Tied/);
  assert.throws(() => settlePredictionRecord({ prediction: structuredClone(prediction), outcome: final(200), settledAt }), /runtime/);
  for (const value of [null, [], {}, NaN]) assert.throws(() => settlePredictionRecord(value), TypeError);
  const event = settlePredictionRecord({ prediction, outcome: final(200), settledAt });
  assert.equal(event.correct, true);
});

test('data-kind provenance never silently promotes synthetic or mixed evidence to connected', () => {
  const model = fit();
  const game = scheduled(200); game.provenance.kind = 'connected';
  assert.equal(forecast(model, { game }).dataKind, 'mixed');
  const connected = training().map(item => ({ ...item, provenance: { ...item.provenance, kind: 'connected' } }));
  const connectedModel = fit({ games: connected });
  const prediction = forecast(connectedModel, { game });
  assert.equal(prediction.dataKind, 'connected');
  assert.equal(prediction.validated, false);
  assert.equal(prediction.probabilityStatus, 'raw-uncalibrated');
});
