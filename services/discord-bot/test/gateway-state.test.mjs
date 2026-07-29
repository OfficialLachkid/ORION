import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGatewayConnectionUrl,
  createEmptySessionState,
  getReconnectPlan,
  hasResumableSession,
} from '../src/gateway-state.mjs';

test('buildGatewayConnectionUrl normalizes version and encoding', () => {
  assert.equal(
    buildGatewayConnectionUrl('wss://gateway.discord.gg'),
    'wss://gateway.discord.gg/?v=10&encoding=json'
  );

  assert.equal(
    buildGatewayConnectionUrl('wss://gateway.discord.gg/?encoding=etf&v=9'),
    'wss://gateway.discord.gg/?encoding=json&v=10'
  );
});

test('hasResumableSession requires session id, resume URL, and sequence', () => {
  const sessionState = {
    sessionId: 'session-1',
    resumeGatewayUrl: 'wss://gateway.discord.gg',
  };

  assert.equal(hasResumableSession(sessionState, 42), true);
  assert.equal(hasResumableSession(sessionState, null), false);
  assert.equal(hasResumableSession(createEmptySessionState(), 42), false);
});

test('getReconnectPlan reconnects and resumes on 1005 when session state exists', () => {
  const plan = getReconnectPlan({
    closeCode: 1005,
    shuttingDown: false,
    sessionState: {
      sessionId: 'session-1',
      resumeGatewayUrl: 'wss://gateway.discord.gg',
    },
    sequence: 7,
  });

  assert.deepEqual(plan, {
    shouldReconnect: true,
    shouldResume: true,
  });
});

test('getReconnectPlan stops on terminal Discord close codes', () => {
  const plan = getReconnectPlan({
    closeCode: 4014,
    shuttingDown: false,
    sessionState: {
      sessionId: 'session-1',
      resumeGatewayUrl: 'wss://gateway.discord.gg',
    },
    sequence: 7,
  });

  assert.deepEqual(plan, {
    shouldReconnect: false,
    shouldResume: false,
  });
});
