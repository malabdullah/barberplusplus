import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resumeStates } from './staging-live-context.mjs';

const states = [{ id: 'a'.repeat(64), name: 'barber-staging-private-db', image: 'sha256:' + 'c'.repeat(64) },
  { id: 'b'.repeat(64), name: 'barber-staging-private-auth', image: 'sha256:' + 'd'.repeat(64) }];
function runtime({ mismatch = false, stuck = false, startFailure = false } = {}) {
  const started = new Set(); const calls = [];
  const docker = args => {
    if (args[0] === 'inspect') {
      const state = states.find(item => item.id === args[1]);
      return JSON.stringify([{ Id: state.id, Name: '/' + state.name, Config: { Image: mismatch ? 'unexpected' : state.image },
        State: { Running: started.has(state.id), Health: { Status: stuck ? 'starting' : 'healthy' } } }]);
    }
    assert.equal(args[0], 'start'); calls.push(args.slice(1));
    if (startFailure && args.includes(states[1].id)) throw new Error('Start rejected');
    for (const id of args.slice(1)) started.add(id);
    return '';
  };
  return { docker, calls };
}
test('recovery validates every identity and resumes DB before application writers', async () => {
  const fixture = runtime(); await resumeStates(fixture.docker, states);
  assert.deepEqual(fixture.calls, [[states[0].id], [states[1].id]]);
});
test('replaced image blocks recovery before any start', async () => {
  const fixture = runtime({ mismatch: true }); await assert.rejects(resumeStates(fixture.docker, states));
  assert.deepEqual(fixture.calls, []);
});
test('unhealthy database cannot start application writers or claim recovery', async () => {
  const fixture = runtime({ stuck: true });
  await assert.rejects(resumeStates(fixture.docker, states, { waitMs: 5, pollMs: 1 }));
  assert.deepEqual(fixture.calls, [[states[0].id]]);
});
test('application restart failure propagates to the recovery operator', async () => {
  const fixture = runtime({ startFailure: true }); await assert.rejects(resumeStates(fixture.docker, states));
});
