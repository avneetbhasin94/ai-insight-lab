// This panel never imports the synthetic fixture pack. Only successful responses
// from the private NBA API can populate its schedule, scores or evidence answers.
const byId = id => document.getElementById(id);
const ui = { result: null, busy: false, loadedDate: null, version: 0 };
const make = (tag, className, text) => { const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el; };
const dateNow = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
byId('real-date').value = dateNow();
byId('real-date').min = '1946-01-01'; byId('real-date').max = `${new Date().getUTCFullYear()+1}-12-31`;
function message(text) { byId('real-message').textContent=text; }
function clearResults() { ui.version++; ui.result=null;ui.loadedDate=null;byId('real-games-grid').replaceChildren();byId('real-filter').hidden=true;byId('real-question-form').hidden=true;byId('real-answer').replaceChildren(); }
async function api(path, options) {
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  try { const response=await fetch(path,{...options,credentials:'same-origin',signal:controller.signal,headers:{'Accept':'application/json',...(options?.body?{'Content-Type':'application/json'}:{})}});
    if(!response.headers.get('content-type')?.includes('application/json')) throw new Error('The private API could not be reached. Sign in to this site and try again.');
    const value=await response.json();if(!response.ok)throw new Error(value.message||'The provider request could not be verified.');return value;
  } catch(problem) { if(problem.name==='AbortError')throw new Error('The request timed out. No substitute scores were generated.');throw problem; } finally {clearTimeout(timer);}
}
async function checkConnection() {
  try {const status=await api('/api/nba/status');const provider=status.provider;
    byId('real-status').textContent=provider.configured?(provider.lastSuccessAt?'Provider connected':'Key configured · not verified'):'Setup needed';
    byId('real-model-state').textContent=`Model generation: ${status.model.state==='configured'?'configured, not live-verified; disabled here':'not connected'}`;
    if(!provider.configured) message('Free account/key setup is still needed. No real game records are loaded. The separate learning lab remains synthetic.');
  }catch(problem){byId('real-status').textContent='Connection unavailable';message(problem.message);}
}
function renderGames() {
  const region=byId('real-games-grid');region.replaceChildren();if(!ui.result)return;
  const query=byId('real-team-search').value.toLowerCase().trim();
  const data=ui.result.data.filter(game=>`${game.homeTeam.fullName} ${game.homeTeam.abbreviation} ${game.awayTeam.fullName} ${game.awayTeam.abbreviation}`.toLowerCase().includes(query));
  data.forEach(game=>{const card=make('article','real-game');const top=make('div','real-game-top');top.append(make('span','',`PROVIDER RECORD #${game.id}`),make('strong','',game.status.toUpperCase()));card.append(top);
    [game.awayTeam,game.homeTeam].forEach((team,index)=>{const row=make('div','real-game-team');const score=index?game.homeScore:game.awayScore;row.append(make('span',`team-badge${index?'':' away'}`,team.abbreviation),make('span','',team.name),make('strong','',score===null?'—':String(score)));card.append(row);});
    card.append(make('p','real-game-date',`${game.date.slice(0,10)} · ${game.status==='scheduled'?'Not started; no result':game.status==='live'?'In progress; scores can change':game.status==='final'?'Final score reported by provider':game.statusState||game.rawStatus||'Status unknown'}`));region.append(card);
  });
  if(!data.length)region.append(make('p','real-message',query?'No loaded matchup matches this team.':'The provider returned no games for this date.'));
}
async function loadGames(event) {
  event?.preventDefault();if(ui.busy)return;ui.busy=true;byId('real-load').disabled=true;clearResults();const version=ui.version;message('Requesting dated provider records…');
  try {const date=byId('real-date').value;const result=await api(`/api/nba/games?date=${encodeURIComponent(date)}`);if(version!==ui.version)return;if(!Array.isArray(result.data)||!result.provenance?.fetchedAt)throw new Error('The response did not contain verifiable game records.');
    ui.result=result;ui.loadedDate=date;byId('real-team-search').value='';byId('real-filter').hidden=false;byId('real-question-form').hidden=result.data.length===0;byId('real-status').textContent='Provider response verified';
    byId('real-source-meta').textContent=`BALLDONTLIE · fetched ${new Date(result.provenance.fetchedAt).toLocaleString()} · cache ${result.provenance.cache} · provider update time unavailable`;
    message(`${result.data.length} actual provider records for ${date}.${result.pagination?.partial?' This response is a partial page; it is not the complete schedule.':''} No injuries or predictions are included.`);renderGames();
  }catch(problem){if(version===ui.version)message(problem.message);}finally{ui.busy=false;byId('real-load').disabled=false;}
}
async function askGames(event) {
  event.preventDefault();if(!ui.result||!ui.loadedDate)return;
  const version=ui.version;const submit=event.submitter; if(submit)submit.disabled=true;
  const region=byId('real-answer');region.replaceChildren(make('p','answer-text','Retrieving the loaded provider evidence…'));
  try {const answer=await api('/api/nba/ask',{method:'POST',body:JSON.stringify({question:byId('real-question').value.trim(),date:ui.loadedDate})});if(version!==ui.version)return;region.replaceChildren(make('div','answer-status',answer.status.toUpperCase()),make('p','answer-text',answer.answer));
    const list=make('div','citation-list');(answer.citations||[]).forEach(source=>{const item=make('div','citation-item');item.append(make('strong','',source.title),make('span','',`${source.id} · event ${source.eventDate||ui.loadedDate} · fetched ${source.fetchedAt||source.asOf}`));list.append(item);});region.append(list);
    if(answer.evidence?.length){const details=make('details','answer-trace');details.append(make('summary','','Inspect actual provider evidence'));answer.evidence.forEach(doc=>details.append(make('p','',doc.text)));region.append(details);}
    region.append(make('p','answer-trace','Retrieval + extractive explanation · no external language model · selected date only.'));
  }catch(problem){if(version!==ui.version)return;region.replaceChildren(make('p','answer-text',problem.message));}finally{if(submit)submit.disabled=false;}
}
byId('real-games-form').addEventListener('submit',loadGames);byId('real-check').addEventListener('click',checkConnection);byId('real-team-search').addEventListener('input',renderGames);byId('real-question-form').addEventListener('submit',askGames);
byId('real-date').addEventListener('change',()=>{clearResults();message('Date changed. Load provider records for the new date.');});
checkConnection();
