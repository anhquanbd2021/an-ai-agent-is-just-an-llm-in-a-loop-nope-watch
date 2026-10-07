// lab.mjs - the Runway Replay domain model. The single source of truth for
// the browser app, the CLI, the server API and the tests. No DOM, timers,
// network, randomness or singleton state: every run replays identically.
export const DEFAULT_REQUEST = 'book me a flight';
export const TOOL_SEQUENCE = Object.freeze(['search', 'calendar', 'weather']);
export const MAX_RETRIES = 2;
export const POLICIES = Object.freeze(['fixed', 'agent']);
export const FLIGHT = Object.freeze({
  id: 'BOS-JFK-0810',
  route: 'BOS -> JFK',
  depart: '08:10',
  cabin: 'economy',
});

// Searches[attempt] is what the fixture Search tool returns for that attempt.
export const SCENARIOS = Object.freeze({
  empty_then_hit: {
    id: 'empty_then_hit',
    label: 'empty first search, flexible retry hits',
    searches: [[], [FLIGHT]],
  },
  always_empty: {
    id: 'always_empty',
    label: 'every search returns [] - the retry budget runs out',
    searches: [[], []],
  },
  instant_hit: {
    id: 'instant_hit',
    label: 'first search already returns an itinerary',
    searches: [[FLIGHT]],
  },
});

export const FAILURE_MODES = Object.freeze([
  { id: 'no_gate', title: 'Booking without an evidence gate', detail: 'POST /book fires after an empty Search; the 422 is swallowed and the answer still claims success.' },
  { id: 'blind_retry', title: 'Retry with the same query', detail: 'Attempt 2 repeats BOS -> JFK with no flexible window, so it returns [] again and burns a retry for nothing.' },
  { id: 'unbounded_loop', title: 'Unbounded loop', detail: 'No MAX_RETRIES ceiling means the run keeps paying for Search calls long after the user has left.' },
]);

export const EVIDENCE_KEYS = Object.freeze(['itinerary', 'calendarReady', 'weatherLoaded']);
export const STATE_LABELS = Object.freeze({
  plan: 'Plan',
  fan_out: 'Fan-out',
  merge: 'Merge',
  decide: 'Decide',
  replan: 'Re-plan',
  book: 'Booking',
  answer: 'Answer',
  blocked: 'Blocked',
});

// ---- state ---------------------------------------------------------------

export function createLab({ request = DEFAULT_REQUEST, scenario = 'empty_then_hit', policy = 'agent', maxRetries = MAX_RETRIES } = {}) {
  const world = SCENARIOS[scenario];
  if (!world) throw new Error(`unknown scenario: ${scenario}`);
  if (!POLICIES.includes(policy)) throw new Error(`unknown policy: ${policy}`);
  return {
    request,
    scenario,
    policy,
    maxRetries,
    attempt: 0,
    flexible: false,
    phase: 'idle',
    trace: [],
    effects: [],
    evidence: { itinerary: false, calendarReady: false, weatherLoaded: false },
    searchAttempts: 0,
    bookingStatus: null,
    message: '',
    done: false,
  };
}

export function resetLab(state) {
  return createLab({ request: state.request, scenario: state.scenario, policy: state.policy, maxRetries: state.maxRetries });
}

function log(state, phase, label, detail) {
  const event = { step: state.trace.length + 1, phase, label: STATE_LABELS[phase] ?? phase, detail };
  state.trace.push(event);
  return event;
}

// ---- plan -> fan-out -> merge -------------------------------------------

// planRequest emits the planner's intent before any tool runs.
export function planRequest(state) {
  state.phase = 'plan';
  return log(state, 'plan', `plan ${state.request}`, `policy=${state.policy}; tools=${TOOL_SEQUENCE.join(', ')}`);
}

// callTool is a deterministic fixture: search output depends on the scenario
// and the attempt; calendar and weather are always ready.
export function callTool(state, tool) {
  const world = SCENARIOS[state.scenario];
  if (tool === 'search') {
    state.searchAttempts += 1;
    const rows = world.searches[Math.min(state.attempt, world.searches.length - 1)] ?? [];
    return { tool: 'search', rows: rows.map(r => ({ ...r })) };
  }
  if (tool === 'calendar') return { tool: 'calendar', booked: false, calendarReady: true };
  if (tool === 'weather') return { tool: 'weather', conditions: 'clear', weatherLoaded: true };
  throw new Error(`unknown tool: ${tool}`);
}

// mergeObservations turns parallel tool output into one evidence snapshot.
export function mergeObservations(state, observations) {
  state.phase = 'merge';
  for (const observation of observations) {
    if (observation.tool === 'search') state.evidence.itinerary = observation.rows.length > 0;
    if (observation.tool === 'calendar') state.evidence.calendarReady = Boolean(observation.calendarReady);
    if (observation.tool === 'weather') state.evidence.weatherLoaded = Boolean(observation.weatherLoaded);
  }
  const missing = EVIDENCE_KEYS.filter(key => !state.evidence[key]);
  return log(state, 'merge', 'merge observations', missing.length === 0 ? 'evidence complete' : `missing=${missing.join(',')}`);
}

// decideNextAction is the control plane. The fixed policy skips the gate and
// returns {action:'book'} even when the itinerary flag is still false.
export function decideNextAction(state) {
  state.phase = 'decide';
  const gate = EVIDENCE_KEYS.every(key => state.evidence[key]);
  if (state.policy === 'fixed') {
    return { action: 'book', reason: 'fixed policy: gate skipped', gate };
  }
  if (gate) return { action: 'book', reason: 'evidence gate passed', gate };
  if (!state.evidence.itinerary && state.attempt + 1 < state.maxRetries) {
    return { action: 'replan', reason: 'empty evidence -> needs_replan', gate };
  }
  return { action: 'blocked', reason: 'SEARCH_EMPTY: retry budget exhausted', gate };
}

// replanRequest is gap-directed: it changes the query, never repeats it.
export function replanRequest(state) {
  state.phase = 'replan';
  state.flexible = true;
  state.attempt += 1;
  return log(state, 'replan', `re-plan attempt ${state.attempt + 1}`, 'query changed: flexible=true (dates +/- 1 day)');
}

// ---- ticks and full runs --------------------------------------------------

// booking is a deterministic fixture of the POST /book endpoint. The unsafe
// run still records the call after an empty search: 422 NO_ITINERARY.
function book(state, gate) {
  state.effects.push({
    method: 'POST',
    path: '/book',
    status: gate ? 200 : 422,
    code: gate ? 'OK' : 'NO_ITINERARY',
    idempotencyKey: `${state.request}:${state.attempt}`,
  });
  state.bookingStatus = gate ? 'confirmed' : 'rejected_422';
  return state.effects[state.effects.length - 1];
}

function fanOut(state) {
  state.phase = 'fan_out';
  const observations = TOOL_SEQUENCE.map(tool => callTool(state, tool));
  state.phase = 'merge';
  mergeObservations(state, observations);
  state.phase = 'merge';
  return observations;
}

// advanceAgent performs exactly one logical tick: plan, fan-out+merge, or
// decide+act. The UI and CLI step through it frame by frame.
export function advanceAgent(state) {
  if (state.done) return { state, tick: null };
  switch (state.phase) {
    case 'idle': {
      planRequest(state);
      state.phase = 'plan';
      break;
    }
    case 'plan':
    case 'retry': {
      fanOut(state);
      state.phase = 'merge';
      break;
    }
    case 'merge': {
      const decision = decideNextAction(state);
      state.phase = 'decide';
      log(state, 'decide', `decide: ${decision.action}`, decision.reason);
      if (decision.action === 'replan') {
        replanRequest(state);
        state.phase = 'retry';
      } else if (decision.action === 'book') {
        const effect = book(state, decision.gate);
        if (decision.gate) {
          state.message = 'Flight booked - confirmation sent - calendar updated';
          state.status = 'confirmed';
        } else {
          state.message = 'Flight booked - confirmation sent - calendar updated';
          state.status = 'false_success';
        }
        log(state, 'book', `POST /book -> ${effect.status} ${effect.code}`, `bookingStatus=${state.bookingStatus}`);
        state.done = true;
      } else {
        state.message = 'Blocked: no itinerary found, nothing was booked.';
        state.status = 'blocked';
        log(state, 'blocked', 'BLOCKED', decision.reason);
        state.done = true;
      }
      break;
    }
    default:
      throw new Error(`cannot advance from phase ${state.phase}`);
  }
  return { state, tick: state.trace.length };
}

export function runAgent({ request = DEFAULT_REQUEST, scenario = 'empty_then_hit', policy = 'agent', maxRetries = MAX_RETRIES } = {}) {
  const state = createLab({ request, scenario, policy, maxRetries });
  let guard = 0;
  while (!state.done && guard++ < 24) advanceAgent(state);
  return { state, trace: state.trace, summary: summarizeRun(state) };
}

export function summarizeRun(state) {
  return {
    status: state.status ?? 'running',
    policy: state.policy,
    scenario: state.scenario,
    evidence: { ...state.evidence },
    searchAttempts: state.searchAttempts,
    bookingStatus: state.bookingStatus,
    effects: state.effects.map(effect => ({ ...effect })),
    message: state.message,
    steps: state.trace.length,
  };
}
