import { FIXTURES, SOURCE_REGISTRY, AS_OF, calculateScenario, getEvidenceAnswer, getObservabilitySnapshot } from './engine.js';

// All data displayed here is from the explicit synthetic fixture pack. API adapters
// remain separate from this browser code so a future key can stay server-side.
const $ = id => document.getElementById(id);
const state = { sport: 'basketball', selected: FIXTURES[0].id, search: '', onlySaved: false, availability: 0, fatigue: 0, saved: new Set(), view: 'context' };
let toastTimer;
try {
  const stored = JSON.parse(localStorage.getItem('fanform-saved-v1') || '[]');
  if (Array.isArray(stored)) state.saved = new Set(stored.filter(id => FIXTURES.some(f => f.id === id)));
} catch { /* Browser privacy settings may disable storage. The session still works. */ }

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function add(parent, ...children) { children.forEach(child => parent.append(child)); return parent; }
function button(text, action, className) {
  const node = element('button', className, text); node.type = 'button'; node.addEventListener('click', action); return node;
}
function link(title, url) {
  const node = element('a', '', title);
  // Links come from the reviewed source register, never generated answers or input.
  if (typeof url === 'string' && url.startsWith('https://')) { node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer'; }
  return node;
}
function currentFixture() { return FIXTURES.find(f => f.id === state.selected); }
function notify(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2400); }
function saveFixture(fixture) {
  if (state.saved.has(fixture.id)) state.saved.delete(fixture.id); else state.saved.add(fixture.id);
  try { localStorage.setItem('fanform-saved-v1', JSON.stringify([...state.saved])); } catch { notify('Saved for this session. Browser storage is unavailable.'); }
  renderCards();
}

function renderCards() {
  const query = state.search.toLowerCase().trim();
  const fixtures = FIXTURES.filter(f => f.sport === state.sport && (!state.onlySaved || state.saved.has(f.id)) && `${f.home.name} ${f.away.name} ${f.home.code} ${f.away.code}`.toLowerCase().includes(query));
  $('matchup-grid').replaceChildren();
  $('fixture-total').textContent = String(fixtures.length);
  $('saved-count').textContent = String(state.saved.size);
  $('saved-filter').setAttribute('aria-pressed', String(state.onlySaved));
  $('empty-state').hidden = fixtures.length !== 0;
  fixtures.forEach(f => {
    const card = element('article', `matchup-card${f.id === state.selected ? ' selected' : ''}`);
    const select = button('', () => selectFixture(f.id), 'matchup-select');
    select.setAttribute('aria-label', `Explore synthetic ${f.home.name} versus ${f.away.name}`);
    select.setAttribute('aria-pressed', String(f.id === state.selected));
    add(select, element('div', 'matchup-kicker', 'NBA / EXAMPLE MATCHUP'));
    [f.home, f.away].forEach((team, i) => {
      const row = element('div', 'team-row');
      const short = team.name.replace(/Los Angeles /, '').replace(/Golden State /, '').replace(/Boston /, '').replace(/New York /, '').replace(/Toronto /, '').replace(/Miami /, '');
      add(row, element('span', `team-badge${i ? ' away' : ''}`, team.code), element('span', 'team-name', short), element('span', 'team-code', team.code)); add(select, row);
    });
    const watch = button(state.saved.has(f.id) ? '★' : '☆', () => saveFixture(f), 'watch-button');
    watch.setAttribute('aria-label', `${state.saved.has(f.id) ? 'Unsave' : 'Save'} ${f.home.code} versus ${f.away.code}`);
    watch.setAttribute('aria-pressed', String(state.saved.has(f.id)));
    const foot = element('div', 'matchup-card-bottom');
    add(foot, element('strong', '', `${f.baselineProbability}%`), element('span', '', `${f.home.code} · synthetic baseline`), element('span', '', 'Explore →'));
    add(card, select, watch, foot); $('matchup-grid').append(card);
  });
}
function selectFixture(id) {
  state.selected = id; state.availability = 0; state.fatigue = 0;
  $('availability').value = '0'; $('fatigue').value = '0';
  renderCards(); renderAnalysis(); renderScenario(); renderQuestions(); clearAnswer();
}
function switchSport(sport) {
  if (state.sport === sport) return;
  state.sport = sport; state.search = ''; $('team-search').value = '';
  document.querySelectorAll('[data-sport]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.sport === sport)));
  selectFixture(FIXTURES.find(f => f.sport === sport).id);
}
function renderAnalysis() {
  const f = currentFixture();
  $('analysis-title').textContent = `${f.home.name} vs ${f.away.name}`;
  $('context-title').textContent = f.tempo;
  $('context-copy').textContent = `${f.note} Compare the same units, then question the assumptions. The baseline is hand-authored, not inferred from these metrics.`;
  $('metric-cards').replaceChildren(); $('comparison-chart').replaceChildren();
  f.metrics.forEach(metric => {
    const card = element('div', 'metric');
    const value = element('div', 'metric-value', metric.home.toFixed(1)); add(value, element('span', 'metric-unit', metric.unit === '%' ? '%' : ''));
    add(card, element('div', 'metric-label', metric.label), value, element('div', 'metric-caption', `${f.home.code} · sample input`)); $('metric-cards').append(card);
    const row = element('div', 'comparison-row'); add(row, element('h3', '', `${metric.label} · ${metric.unit}`));
    const scale = Math.max(metric.home, metric.away) * 1.12;
    [f.home, f.away].forEach((team, index) => {
      const valueNumber = index ? metric.away : metric.home;
      const teamRow = element('div', `compare-team${index ? ' away' : ''}`);
      const bar = element('div', 'compare-bar'); const fill = element('span'); fill.style.width = `${valueNumber / scale * 100}%`; bar.append(fill); bar.setAttribute('aria-hidden', 'true');
      add(teamRow, element('span', '', team.code), bar, element('strong', '', valueNumber.toFixed(1))); add(row, teamRow);
    }); $('comparison-chart').append(row);
  });
  $('fatigue-label').textContent = 'Hypothetical rest disadvantage';
  renderView();
}
function renderView() {
  $('context-content').hidden = state.view !== 'context'; $('numbers-content').hidden = state.view !== 'numbers';
  $('context-tab').setAttribute('aria-pressed', String(state.view === 'context')); $('numbers-tab').setAttribute('aria-pressed', String(state.view === 'numbers'));
}
function renderScenario() {
  const f = currentFixture();
  const result = calculateScenario(f.sport, state.availability, state.fatigue, f.baselineProbability);
  $('scenario-home').textContent = f.home.code; $('scenario-away').textContent = f.away.code;
  $('scenario-probability').textContent = String(result.probability);
  $('probability-name').textContent = `${f.home.name} · illustrative share`;
  $('probability-fill').style.width = `${result.probability}%`;
  $('home-prob-label').textContent = `${f.home.code} ${result.probability}%`; $('away-prob-label').textContent = `${f.away.code} ${result.awayProbability}%`;
  const levels = ['None', 'Low', 'Medium', 'High', 'Maximum'];
  $('availability-output').textContent = levels[Math.round(state.availability * 4)]; $('fatigue-output').textContent = levels[Math.round(state.fatigue * 4)];
  $('scenario-change').textContent = result.change ? `${result.change} percentage points vs baseline` : 'Baseline scenario';
  $('formula-note').textContent = `${result.baselineProbability}% − ${result.availabilityPenalty} absence points − ${result.fatiguePenalty} workload points = ${result.probability}%. Invented effect sizes; no calibrated forecast.`;
}
function renderQuestions() {
  const f = currentFixture(); $('suggested-questions').replaceChildren();
  const questions = ['Compare these teams', 'What does pace mean?', 'Who is injured today?'];
  questions.forEach(question => $('suggested-questions').append(button(question, () => askQuestion(question))));
  $('question-input').placeholder = 'Ask about pace, a scenario, or the evidence...';
}
function clearAnswer() {
  const box = element('div', 'answer-placeholder'); const text = element('div');
  add(text, element('strong', '', 'Every answer should have a trail.'), element('p', '', 'Try a question to inspect the supporting evidence.'));
  add(box, element('span', '', '⌕'), text); $('answer-region').replaceChildren(box); $('question-input').value = '';
}
function askQuestion(question) {
  const f = currentFixture(); $('question-input').value = question;
  const result = getEvidenceAnswer({ question, sport: f.sport, matchupId: f.id, scenario: { availability: state.availability, fatigue: state.fatigue } });
  const statusLabels = { supported: 'EVIDENCE FOUND', insufficient: 'INSUFFICIENT EVIDENCE', refused: 'OUTSIDE THE LAB’S SCOPE' };
  const region = $('answer-region'); region.replaceChildren(element('div', 'answer-status', statusLabels[result.status]), element('p', 'answer-text', result.answer));
  const citations = element('div', 'citation-list');
  result.citations.forEach((source, index) => {
    const item = element('div', 'citation-item');
    add(item, source.url ? link(`[${index + 1}] ${source.title}`, source.url) : element('strong', '', `[${index + 1}] ${source.title}`), element('span', '', `${source.kind} · ${source.asOf} · ${source.url ? 'supports definitions only' : 'synthetic fixture / method'}`));
    citations.append(item);
  });
  if (result.citations.length) region.append(citations);
  if (result.evidence.length) {
    const details = element('details', 'answer-trace'); add(details, element('summary', '', 'Inspect retrieved passages'));
    result.evidence.forEach(doc => add(details, element('p', '', `${doc.id}: ${doc.text}`))); region.append(details);
  }
  const trace = `Intent: ${result.classification?.intent || 'guard'} · ${result.evidence.length} evidence passages · ${result.latencyMs.toFixed(2)} ms · 0 external model calls`;
  region.append(element('div', 'answer-trace', trace));
}

function paragraph(parent, text) { parent.append(element('p', '', text)); }
function heading(parent, text) { parent.append(element('h3', '', text)); }
function showDialog(title, build) {
  $('dialog-title').textContent = title; $('dialog-content').replaceChildren(); build($('dialog-content'));
  if (!$('detail-dialog').open) $('detail-dialog').showModal();
}
function conceptTable(parent, rows) {
  const table = element('table', 'concept-table');
  const head = element('thead'); const header = element('tr'); ['CONCEPT', 'IMPLEMENTATION', 'STATE'].forEach(text => header.append(element('th', '', text))); add(head, header); table.append(head);
  const body = element('tbody'); rows.forEach(row => { const tr = element('tr'); row.forEach(text => tr.append(element('td', '', text))); body.append(tr); }); table.append(body); parent.append(table);
}
function showMethod() {
  showDialog('The AI, without the mystery.', parent => {
    paragraph(parent, 'The core of this prototype is an evidence pipeline: classify the question → retrieve approved passages → calculate exact numbers → assemble a structured answer → cite the evidence or abstain. It is deliberately small enough to inspect.');
    conceptTable(parent, [
      ['Intent classification', 'Small supervised multinomial Naive Bayes text model; trained on hand-authored examples.', 'Working locally'],
      ['Retrieval + grounding', 'BM25 lexical retrieval over reviewed, sport-scoped passages; source IDs and dates travel with the answer.', 'Working locally'],
      ['Numerical tools', 'Deterministic scenario and effective field goal percentage functions.', 'Working; scenario weights invented'],
      ['Evals + observability', 'Held-out questions, retrieval/citation checks, math and abstention tests. In-memory traces omit raw questions.', 'Runnable code + session traces'],
      ['Embeddings / vector search', 'Dependency-injected vector RAG module; tests use fake adapters. No real embedding model is connected.', 'Mock-tested boundary'],
      ['Generative RAG / model API', 'Server module supports an injected generator, budgets and output checks. It is not deployed or connected here.', 'Mock-tested boundary'],
      ['Prediction model', 'Current percentages are hand-authored baselines with a sensitivity formula; chronological backtests and calibration remain to build.', 'Simulated / planned']
    ]);
    const note = element('div', 'dialog-note'); paragraph(note, 'No API keys, live sports APIs, external models or analytics trackers are used by this website. It cannot verify injuries, scores or upcoming schedules.'); parent.append(note);
    const snapshot = getObservabilitySnapshot(); heading(parent, 'This browser session');
    paragraph(parent, `${snapshot.requests} questions processed · ${snapshot.supported} supported · ${snapshot.insufficient} insufficient · ${snapshot.refused} refused · ${snapshot.meanLatencyMs} ms mean engine latency. External API calls: 0. External AI cost: $0. These are current session measurements, not production benchmarks.`);
    heading(parent, 'What would become real next?'); paragraph(parent, 'Licensed NBA data and dated injury statuses arrive through a server cache. A bounded model can then explain retrieved facts; a separately trained and backtested model supplies any forecast. A language model should never invent the probability.');
  });
}
function showSources() {
  showDialog('The data desk.', parent => {
    const note = element('div', 'dialog-note'); paragraph(note, `Fixture pack v0.1 · created ${AS_OF}. Every team metric, matchup and scenario baseline is invented for teaching. There is no actual scheduled event or player injury implied.`); parent.append(note);
    heading(parent, 'Connected data'); paragraph(parent, 'Live scores: not connected. Injury reports: not connected. News: not connected. External language model: not connected. Team names identify examples; badges are original text illustrations, not official logos.');
    heading(parent, 'Definition references');
    SOURCE_REGISTRY.filter(s => s.url).forEach(source => { const p = element('p'); p.append(link(source.title, source.url)); parent.append(p); paragraph(parent, source.note); });
    heading(parent, 'Original design references');
    const refs = [['The Stat Desk', 'https://www.thestatdeskhq.app/nba/'], ['Sofascore', 'https://www.sofascore.com/basketball'], ['DunksAndThrees', 'https://dunksandthrees.com/games'], ['NBA Stats glossary', 'https://www.nba.com/stats/help/glossary']];
    paragraph(parent, 'We studied matchup context, explanatory metrics and evidence-led Q&A. Layout, graphics, copy and code here are original. Competitor data, ratings and predictions are not used.'); refs.forEach(([title, url]) => { const p = element('p'); p.append(link(title, url)); parent.append(p); });
    heading(parent, 'A low-cost route forward');
    paragraph(parent, 'Official pricing checked 16 November 2026: BALLDONTLIE NBA ALL-STAR is US$9.99/month with player stats and injury reports. No subscription is active here. Model usage is extra; the provider’s actual endpoint coverage must be tested before launch.');
    const p = element('p'); p.append(link('NBA API docs', 'https://nba.balldontlie.io/'), document.createTextNode(' · '), link('NBA provider terms', 'https://www.balldontlie.io/terms.html')); parent.append(p);
  });
}
function showLearning(kind) {
  showDialog(kind === 'probability' ? 'Probability is not a promise.' : 'The missing-data question.', parent => {
    if (kind === 'probability') {
      paragraph(parent, 'If a properly calibrated model assigns 60% to many comparable events, that group should win about 60% of the time in the long run. It does not mean a particular event is certain, or that a short streak proves the model works.');
      heading(parent, 'Our prototype is not calibrated'); paragraph(parent, 'Fanform’s percentages are synthetic. Changing a slider demonstrates sensitivity to assumptions. It does not establish which team will win or whether a bet has value.');
      heading(parent, 'How we would test a real model'); paragraph(parent, 'Train on older games, test on later games, compare with simple baselines, and report Brier score, log loss and calibration by probability band. Freeze each forecast before tip-off so later injury news and results cannot leak backward.');
    } else {
      paragraph(parent, 'A missing injury record is not proof that a player is healthy. A missing player stat is not proof that they were injured. Data can be late, incomplete or outside a provider’s coverage.');
      heading(parent, 'Every report needs a clock'); paragraph(parent, 'Record the event time, fetch time, provider’s update time when supplied, and the source. Label stale reports. Preserve “unknown” rather than inventing a status.');
      heading(parent, 'An injury status is not an effect size'); paragraph(parent, 'A dated injury report can support who is listed out, doubtful or questionable. Estimating a player’s impact also needs historical minutes, lineup context and a tested model. Until those are verified, keep the effect as an explicit hypothetical assumption.');
    }
  });
}

// A single event path per control keeps state changes explicit and reviewable.
document.querySelectorAll('[data-sport]').forEach(node => node.addEventListener('click', () => switchSport(node.dataset.sport)));
$('team-search').addEventListener('input', event => { state.search = event.target.value; renderCards(); });
$('saved-filter').addEventListener('click', () => { state.onlySaved = !state.onlySaved; renderCards(); });
$('context-tab').addEventListener('click', () => { state.view = 'context'; renderView(); });
$('numbers-tab').addEventListener('click', () => { state.view = 'numbers'; renderView(); });
$('availability').addEventListener('input', event => { state.availability = Number(event.target.value) / 100; renderScenario(); clearAnswer(); });
$('fatigue').addEventListener('input', event => { state.fatigue = Number(event.target.value) / 100; renderScenario(); clearAnswer(); });
$('reset-scenario').addEventListener('click', () => { state.availability = state.fatigue = 0; $('availability').value = $('fatigue').value = '0'; renderScenario(); clearAnswer(); });
$('explain-scenario').addEventListener('click', () => { askQuestion('Explain this hypothetical scenario and its formula'); $('evidence-lab').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); });
$('question-form').addEventListener('submit', event => { event.preventDefault(); if ($('question-input').value.trim()) askQuestion($('question-input').value.trim()); });
['method-nav', 'engine-details', 'footer-method'].forEach(id => $(id).addEventListener('click', showMethod));
['data-nav', 'notice-details', 'sources-button'].forEach(id => $(id).addEventListener('click', showSources));
document.querySelectorAll('[data-learn]').forEach(node => node.addEventListener('click', () => showLearning(node.dataset.learn)));
$('close-dialog').addEventListener('click', () => $('detail-dialog').close());
$('detail-dialog').addEventListener('click', event => { if (event.target === $('detail-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
document.addEventListener('keydown', event => { if (event.key === '/' && !event.ctrlKey && !event.metaKey && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && !$('detail-dialog').open) { event.preventDefault(); $('team-search').focus(); } });
renderCards(); renderAnalysis(); renderScenario(); renderQuestions();
