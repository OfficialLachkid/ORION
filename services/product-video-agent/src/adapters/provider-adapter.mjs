export class ProductProviderAdapter {
  constructor(name) {
    if (!name) {
      throw new Error('Provider adapters require a name.');
    }

    this.name = name;
  }

  async importProduct() {
    throw new Error(`${this.name} must implement importProduct().`);
  }

  normalize() {
    throw new Error(`${this.name} must implement normalize().`);
  }
}
export function assertProviderAdapter(adapter) {
  if (!adapter?.name || typeof adapter.importProduct !== 'function' || typeof adapter.normalize !== 'function') {
    throw new TypeError('A provider adapter must expose name, importProduct(), and normalize().');
  }

  return adapter;
}
