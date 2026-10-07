import { createLab, advanceAgent, runAgent, summarizeRun, STATE_LABELS } from '/lab.mjs';

const $ = selector => document.querySelector(selector);
const traceList = $('#trace');
const verdict = $('#verdict');
const answer = $('#answer');
const replanStrip = $('#replan');

let state = createLab();
let busy = false;

function options() {
  return {
    policy: document.querySelector('input[name="policy"]:checked').value,
    scenario: document.querySelector('input[name="scenario"]:checked').value,
  };
}

function resetBoard() {
  state = createLab(options());
  for (const tool of ['search', 'calendar', 'weather']) {
    const rail = $(`#rail-${tool}`);
    rail.classList.remove('active', 'coral', 'mint', 'dim');
    $(`#rail-${tool}-detail`).textContent = 'idle';
  }
  $('#gate').classList.remove('pass', 'fail');
  $('#gate-detail').textContent = 'itinerary + calendarReady + weatherLoaded';
  $('#booking').classList.remove('called', 'rejected', 'confirmed');
  $('#booking-detail').textContent = 'not called';
  replanStrip.hidden = true;
  traceList.innerHTML = '<li class="trace-empty" id="trace-empty">No ticks yet — press Step or Run replay.</li>';
  answer.hidden = true;
  answer.textContent = '';
  answer.classList.remove('coral', 'mint');
  setVerdict('idle', 'badge');
}

function setVerdict(text, kind) {
  verdict.textContent = text;
  verdict.className = `badge ${kind}`;
}

function renderTick() {
  traceList.innerHTML = state.trace.map(event => `
    <li class="trace-row">
      <span class="trace-step">${String(event.step).padStart(2, '0')}</span>
      <span class="trace-phase phase-${event.phase}">${STATE_LABELS[event.phase] ?? event.phase}</span>
      <span class="trace-detail">${event.label} — ${event.detail}</span>
    </li>`).join('');

  const searchRows = state.evidence.itinerary ? 'BOS -> JFK 08:10' : '[]';
  $('#rail-search-detail').textContent = `attempt ${state.searchAttempts} · ${searchRows}`;
  $('#rail-calendar-detail').textContent = state.evidence.calendarReady ? 'booked:false · ready' : 'idle';
  $('#rail-weather-detail').textContent = state.evidence.weatherLoaded ? 'clear · loaded' : 'idle';

  const activeTools = state.phase === 'merge' || state.phase === 'fan_out';
  for (const tool of ['search', 'calendar', 'weather']) {
    $(`#rail-${tool}`).classList.toggle('active', activeTools);
    $(`#rail-${tool}`).classList.toggle('mint', state.evidence[tool === 'search' ? 'itinerary' : tool === 'calendar' ? 'calendarReady' : 'weatherLoaded']);
    $(`#rail-${tool}`).classList.toggle('coral', tool === 'search' && state.searchAttempts > 0 && !state.evidence.itinerary);
    $(`#rail-${tool}`).classList.toggle('dim', state.done);
  }

  const gate = $('#gate');
  const gatePassed = state.evidence.itinerary && state.evidence.calendarReady && state.evidence.weatherLoaded;
  gate.classList.toggle('pass', gatePassed);
  gate.classList.toggle('fail', !gatePassed && state.searchAttempts > 0);
  if (state.searchAttempts > 0) {
    const missing = ['itinerary', 'calendarReady', 'weatherLoaded'].filter(key => !state.evidence[key]);
    $('#gate-detail').textContent = gatePassed ? 'gate passed — all evidence true' : `gate closed — missing ${missing.join(', ')}`;
  }
  replanStrip.hidden = state.attempt === 0;
  if (state.attempt > 0) $('#replan-detail').textContent = `flexible=true · attempt ${state.attempt + 1}`;

  const booking = $('#booking');
  booking.classList.toggle('called', state.effects.length > 0);
  booking.classList.toggle('rejected', state.bookingStatus === 'rejected_422');
  booking.classList.toggle('confirmed', state.bookingStatus === 'confirmed');
  if (state.effects.length > 0) {
    const effect = state.effects[0];
    $('#booking-detail').textContent = `${effect.status} ${effect.code} · ${state.effects.length} call`;
  }

  if (state.message) {
    answer.hidden = false;
    answer.textContent = state.message;
    answer.classList.toggle('coral', state.status === 'false_success');
    answer.classList.toggle('mint', state.status === 'confirmed');
  }

  const summary = summarizeRun(state);
  if (state.done) {
    if (state.status === 'false_success') setVerdict('false success — 422 swallowed', 'coral');
    else if (state.status === 'confirmed') setVerdict('confirmed — booked once', 'mint');
    else setVerdict('blocked — SEARCH_EMPTY, no booking', 'amber');
  } else {
    setVerdict(`tick ${state.trace.length} · ${STATE_LABELS[state.phase] ?? state.phase}`, 'cyan');
  }
}

async function step() {
  if (state.done || busy) return;
  busy = true;
  advanceAgent(state);
  renderTick();
  busy = false;
}

async function run() {
  if (busy) return;
  busy = true;
  const result = runAgent(options());
  state = result.state;
  renderTick();
  busy = false;
}

$('#step').addEventListener('click', step);
$('#run').addEventListener('click', run);
$('#reset').addEventListener('click', resetBoard);
for (const input of document.querySelectorAll('input[name="policy"], input[name="scenario"]')) {
  input.addEventListener('change', resetBoard);
}

resetBoard();
