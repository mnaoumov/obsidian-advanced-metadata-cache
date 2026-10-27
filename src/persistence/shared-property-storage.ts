import type { SharedDataStore } from '@mnaoumov/obsidian-lib/data-stores/shared-data-store';

import type { IndexStorage } from './index-storage.ts';

interface PropertyDocument {
  readonly properties: Record<string, unknown>;
  readonly version: number;
}

interface SharedPropertyStorageConstructorParams {
  readonly local: IndexStorage;
  readonly names: SharedDataStore;
}

/**

 * Derived values stay local; the grow-only registration set is authoritative shared state.

 */
export class SharedPropertyStorage implements IndexStorage {
  private readonly params: SharedPropertyStorageConstructorParams;

  public constructor(params: SharedPropertyStorageConstructorParams) {
    this.params = params;
  }

  public async read(): Promise<string> {
    const json = await this.params.local.read();
    const document = json === null ? { properties: {}, version: 1 } : JSON.parse(json) as PropertyDocument;
    await this.params.names.synchronize();
    for (const [name] of this.params.names.entries()) {
      if (!Object.hasOwn(document.properties, name)) {
        Object.defineProperty(document.properties, name, { enumerable: true, value: {} });
      }
    }
    return JSON.stringify(document);
  }

  public async write(json: string): Promise<void> {
    const document = JSON.parse(json) as PropertyDocument;
    await this.params.names.setMany(Object.keys(document.properties).filter((name) => this.params.names.get(name) === undefined).map((name) => [name, 1]));
    await this.params.local.write(json);
  }
}
