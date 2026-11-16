/** FANFORM's bundled, editorially controlled evidence. No live feed is connected. */
export const AS_OF = '2026-11-16';

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const SOURCES = freeze([
  { id: 'nba-glossary', title: 'NBA Stats glossary', url: 'https://www.nba.com/stats/help/glossary', kind: 'official-reference', asOf: AS_OF, note: 'Definition reference, verified 16 November 2026. No statistics feed or republication licence is implied.' },
  { id: 'fanform-method', title: 'FANFORM synthetic method card', kind: 'synthetic-method', asOf: AS_OF, note: 'Hand-authored educational demonstration. No trained outcome model, injury feed, bookmaker odds or validated forecast.' },
  { id: 'fanform-availability', title: 'FANFORM data availability register', kind: 'availability', asOf: AS_OF, note: 'No live API, current injury report, external language model or account is connected.' }
]);

const fixture = (id, sport, league, home, away, baselineProbability, metrics, tempo, note) => ({
  id, sport, league, home: { code: home[0], name: home[1], color: home[2] }, away: { code: away[0], name: away[1], color: away[2] },
  baselineProbability, metrics, tempo, note, asOf: AS_OF, kind: 'synthetic', availability: 'demo',
  title: `${away[1]} at ${home[1]}`, dateLabel: 'Illustrative matchup · no scheduled game implied',
  sourceId: `fixture-${id}`
});

export const FIXTURES = freeze([
  fixture('nba-bos-nyk', 'basketball', 'NBA · synthetic', ['BOS', 'Boston Celtics', '#7fe5a2'], ['NYK', 'New York Knicks', '#ffb675'], 58,
    [{ label: 'Offensive rating', home: 119.2, away: 115.8, unit: 'pts / 100' }, { label: 'Pace', home: 99.1, away: 96.8, unit: 'poss / 48' }, { label: 'eFG%', home: 56.8, away: 54.1, unit: '%' }], 'Boston +3.4 illustrative offensive rating', 'A fictional efficiency edge makes Boston the demonstration favorite.'),
  fixture('nba-lal-gsw', 'basketball', 'NBA · synthetic', ['LAL', 'Los Angeles Lakers', '#c8adff'], ['GSW', 'Golden State Warriors', '#f4d16e'], 51,
    [{ label: 'Offensive rating', home: 116.2, away: 116.9, unit: 'pts / 100' }, { label: 'Pace', home: 100.5, away: 102.1, unit: 'poss / 48' }, { label: 'eFG%', home: 55.6, away: 56.1, unit: '%' }], 'A near-even synthetic matchup', 'The one-point baseline edge is a fixture input, not a fitted model output.'),
  fixture('nba-tor-mia', 'basketball', 'NBA · synthetic', ['TOR', 'Toronto Raptors', '#ff8b96'], ['MIA', 'Miami Heat', '#ffcf92'], 48,
    [{ label: 'Offensive rating', home: 112.8, away: 114.6, unit: 'pts / 100' }, { label: 'Pace', home: 100.2, away: 96.4, unit: 'poss / 48' }, { label: 'eFG%', home: 53.2, away: 54.4, unit: '%' }], 'Contrasting fictional pace profiles', 'A slower Miami profile offers a useful explanation example; all inputs are invented.')
]);

const doc = (id, title, text, sport, sourceId, extra = {}) => ({ id, title, text, sport, sourceId, kind: 'official-reference', asOf: AS_OF, ...extra });
export const EVIDENCE = freeze([
  doc('nba-pace', 'Reading pace', 'Pace: possessions/48 minutes.', 'basketball', 'nba-glossary'),
  doc('nba-offrtg', 'Reading offensive rating', 'Offensive rating: points/100 possessions.', 'basketball', 'nba-glossary'),
  doc('nba-efg', 'Reading effective field goal percentage', 'eFG% = 100 × (FGM + 0.5 × 3PM) / FGA.', 'basketball', 'nba-glossary'),
  doc('method-scenarios', 'How the synthetic scenario works', 'The scenario uses a hand-authored baseline, then subtracts hypothetical absence-impact and workload penalties, up to 10 and 5 percentage points respectively. The displayed percentage is bounded from 5 to 95. These choices are invented and have not been trained, calibrated or backtested.', 'all', 'fanform-method', { kind: 'synthetic-method' }),
  doc('method-probability', 'A probability is not a promise', 'FANFORM percentages are synthetic educational inputs, not validated forecasts or bookmaker prices. A probability demonstration cannot establish betting value, profit or guaranteed results. There is no calibration or backtest result to report.', 'all', 'fanform-method', { kind: 'synthetic-method' }),
  doc('availability-report', 'Data sources and what is actually connected', 'No live scores, current schedules, current injuries, player availability feed, paid sports API or external language model is connected. All matchups and numeric team profiles are hand-authored synthetic fixtures created 16 November 2026. The official NBA link supports definitions only.', 'all', 'fanform-availability', { kind: 'availability' }),
  doc('method-retrieval', 'How this evidence assistant works', 'The local assistant classifies an intent with a small trained Naive Bayes text classifier, retrieves approved evidence with lexical BM25 scoring, and assembles an extractive answer with source IDs. It does not call a language model, use embeddings or perform generative RAG. User questions and traces stay in browser memory.', 'all', 'fanform-method', { kind: 'synthetic-method' }),
  ...FIXTURES.map(f => doc(`doc-${f.id}`, `${f.home.name} vs ${f.away.name} · synthetic fixture`,
    `Synthetic ${f.sport} demonstration: ${f.home.name} (${f.home.code}) vs ${f.away.name} (${f.away.code}). The invented ${f.home.code} baseline is ${f.baselineProbability}%. ${f.metrics.map(m => `${m.label}: ${f.home.code} ${m.home}, ${f.away.code} ${m.away} ${m.unit}`).join('; ')}. ${f.note} This is not a real scheduled match, current team form, injury report or validated forecast.`, f.sport, f.sourceId,
    { kind: 'synthetic', matchupId: f.id }))
]);

export const SOURCE_REGISTRY = freeze([
  ...SOURCES,
  ...FIXTURES.map(f => ({ id: f.sourceId, title: `${f.home.code}–${f.away.code} synthetic fixture`, kind: 'synthetic', asOf: f.asOf, note: 'Created for this prototype; no real game or current data claim.' }))
]);
