import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REQUEST, TOOL_SEQUENCE, MAX_RETRIES, EVIDENCE_KEYS,
  createLab, resetLab, planRequest, callTool, mergeObservations,
  decideNextAction, replanRequest, advanceAgent, runAgent, summarizeRun,
} from '../public/lab.mjs';

test('planRequest emits the intent before any tool runs', () => {
  const state = createLab({ policy: 'agent' });
  const event = planRequest(state);
  assert.equal(event.phase, 'plan');
  assert.match(event.detail, /search, calendar, weather/);
  assert.deepEqual(TOOL_SEQUENCE, ['search', 'calendar', 'weather']);
});

test('fan-out is parallel and merge sets all evidence flags', () => {
  const state = createLab({ policy: 'agent', scenario: 'instant_hit' });
  const observations = TOOL_SEQUENCE.map(tool => callTool(state, tool));
  assert.equal(observations.length, 3);
  assert.deepEqual(observations.map(o => o.tool), TOOL_SEQUENCE);
  const event = mergeObservations(state, observations);
  assert.match(event.detail, /evidence complete/);
  assert.deepEqual(EVIDENCE_KEYS.map(key => state.evidence[key]), [true, true, true]);
});

test('empty search becomes needs_replan with a changed query', () => {
  const state = createLab({ policy: 'agent' });
  const observation = callTool(state, 'search');
  assert.deepEqual(observation.rows, []);
  mergeObservations(state, [observation]);
  const decision = decideNextAction(state);
  assert.equal(decision.action, 'replan');
  assert.equal(decision.reason, 'empty evidence -> needs_replan');
  const event = replanRequest(state);
  assert.equal(state.flexible, true);
  assert.equal(state.attempt, 1);
  assert.match(event.detail, /flexible=true/);
  const retry = callTool(state, 'search');
  assert.equal(retry.rows[0].route, 'BOS -> JFK');
});

test('fixed policy skips the gate, books on a 422, and still claims success', () => {
  const { state, summary } = runAgent({ policy: 'fixed' });
  assert.equal(summary.searchAttempts, 1);
  assert.equal(state.evidence.itinerary, false);
  assert.equal(summary.bookingStatus, 'rejected_422');
  assert.equal(summary.effects.length, 1);
  assert.equal(summary.effects[0].status, 422);
  assert.equal(summary.effects[0].code, 'NO_ITINERARY');
  assert.equal(summary.status, 'false_success');
  assert.equal(summary.message, 'Flight booked - confirmation sent - calendar updated');
});

test('agent policy replans, passes the gate, and books exactly once', () => {
  const { state, summary } = runAgent({ policy: 'agent' });
  assert.equal(summary.searchAttempts, 2);
  assert.equal(summary.evidence.itinerary, true);
  assert.equal(summary.evidence.calendarReady, true);
  assert.equal(summary.evidence.weatherLoaded, true);
  assert.equal(summary.bookingStatus, 'confirmed');
  assert.equal(summary.effects.length, 1);
  assert.equal(summary.effects[0].status, 200);
  assert.equal(summary.status, 'confirmed');
  const books = state.trace.filter(e => e.phase === 'book');
  assert.equal(books.length, 1);
});

test('MAX_RETRIES=2 blocks the run after a second empty search', () => {
  const { state, summary } = runAgent({ policy: 'agent', scenario: 'always_empty' });
  assert.equal(MAX_RETRIES, 2);
  assert.equal(summary.searchAttempts, 2);
  assert.equal(summary.status, 'blocked');
  assert.equal(summary.bookingStatus, null);
  assert.deepEqual(summary.effects, []);
  assert.match(state.trace.at(-1).detail, /SEARCH_EMPTY/);
});

test('advanceAgent replays the same ticks deterministically', () => {
  const a = createLab({ policy: 'agent' });
  const b = createLab({ policy: 'agent' });
  advanceAgent(a); advanceAgent(a);
  advanceAgent(b); advanceAgent(b);
  assert.deepEqual(a.trace, b.trace);
  while (!a.done) advanceAgent(a);
  assert.deepEqual(a.trace, runAgent({ policy: 'agent' }).trace);
});

test('resetLab restores the initial state for the same options', () => {
  const state = runAgent({ policy: 'agent' }).state;
  const fresh = resetLab(state);
  assert.equal(fresh.done, false);
  assert.equal(fresh.trace.length, 0);
  assert.equal(fresh.policy, state.policy);
  assert.equal(fresh.scenario, state.scenario);
});

test('summarizeRun reports the control-plane facts', () => {
  const { state } = runAgent({ policy: 'agent' });
  const summary = summarizeRun(state);
  assert.deepEqual(Object.keys(summary), [
    'status', 'policy', 'scenario', 'evidence', 'searchAttempts',
    'bookingStatus', 'effects', 'message', 'steps',
  ]);
  assert.equal(summary.scenario, 'empty_then_hit');
  assert.equal(DEFAULT_REQUEST, 'book me a flight');
});
