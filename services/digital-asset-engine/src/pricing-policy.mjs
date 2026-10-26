const STATIC_PRICE_BANDS = Object.freeze([
  { maximumAssets: 4, maximumPrice: 1.99 },
  { maximumAssets: 8, maximumPrice: 3.99 },
  { maximumAssets: 16, maximumPrice: 4.99 },
  { maximumAssets: 24, maximumPrice: 5.99 },
  { maximumAssets: Number.POSITIVE_INFINITY, maximumPrice: 6.99 },
]);

function maximumStaticPrice(assetCount) {
  const count = Math.max(1, Number(assetCount) || 1);
  return STATIC_PRICE_BANDS.find((band) => count <= band.maximumAssets).maximumPrice;
}

/**
 * Research may suggest a price, but a first release currently contains static
 * sprites only. Keep that suggestion below a deterministic value ceiling
 * until the immutable package proves that it contains richer deliverables.
 */
export function applyInitialReleasePricingPolicy(price, assetCount) {
  const requested = Math.max(0, Number(price?.amount) || 0);
  const maximum = maximumStaticPrice(assetCount);
  return {
    amount: Math.min(requested, maximum),
    currency: String(price?.currency || 'USD').toUpperCase(),
  };
}

export function describeInitialReleasePricingPolicy(assetCount) {
  return {
    asset_count: Math.max(1, Number(assetCount) || 1),
    deliverable_tier: 'static_initial_release',
    maximum_price: maximumStaticPrice(assetCount),
  };
}
