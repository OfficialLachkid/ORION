import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyInitialReleasePricingPolicy,
  describeInitialReleasePricingPolicy,
} from '../src/pricing-policy.mjs';

test('caps static initial releases by included asset count', () => {
  assert.deepEqual(
    applyInitialReleasePricingPolicy({ amount: 6.99, currency: 'USD' }, 16),
    { amount: 4.99, currency: 'USD' },
  );
  assert.deepEqual(
    applyInitialReleasePricingPolicy({ amount: 4.99, currency: 'EUR' }, 8),
    { amount: 3.99, currency: 'EUR' },
  );
});

test('preserves a lower research price instead of raising it', () => {
  assert.deepEqual(
    applyInitialReleasePricingPolicy({ amount: 2.49, currency: 'usd' }, 16),
    { amount: 2.49, currency: 'USD' },
  );
});

test('describes the deterministic static-release tier', () => {
  assert.deepEqual(describeInitialReleasePricingPolicy(16), {
    asset_count: 16,
    deliverable_tier: 'static_initial_release',
    maximum_price: 4.99,
  });
});
