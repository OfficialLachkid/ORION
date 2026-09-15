import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverNightShiftChannelRuntimes } from './pokemon-maintenance-runtime.mjs';

const POKEMON_CHANNEL_SELECTORS = Object.freeze([
  'poke-quizz-youtube',
  'poke-guess-youtube',
  'dexguess-youtube',
  'trivamon-youtube',
  'proffmon-youtube',
]);

test('all Pokemon channel replenish pools include Build Your Team at weight 2', async () => {
  const runtimes = await discoverNightShiftChannelRuntimes();
  const runtimeByChannel = new Map(runtimes.map((runtime) => [runtime.channelSelector, runtime]));

  for (const channelSelector of POKEMON_CHANNEL_SELECTORS) {
    const runtime = runtimeByChannel.get(channelSelector);
    assert.ok(runtime, `${channelSelector} must have a night-shift runtime`);
    assert.ok(
      runtime.nightShift.reviewBacklogTemplateIds.includes('pokemon.build-your-team.v1'),
      `${channelSelector} must replenish Build Your Team`,
    );
    assert.equal(
      runtime.nightShift.reviewBacklogTemplateWeights['pokemon.build-your-team.v1'],
      2,
      `${channelSelector} must weight Build Your Team at 2`,
    );
  }

  assert.equal(runtimeByChannel.has('techy-gadgets-youtube'), false);
});
