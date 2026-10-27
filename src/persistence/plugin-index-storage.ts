import type { App } from 'obsidian';

import { LocalDataStore } from '@mnaoumov/obsidian-lib/data-stores/local-data-store';
import { SharedDataStore } from '@mnaoumov/obsidian-lib/data-stores/shared-data-store';
import { noopAsync } from '@mnaoumov/typescript-lib/function';

import type { IndexStorage } from './index-storage.ts';

import { parsePersistedHeadingTimes } from '../modules/headings/heading-times-index.ts';
import { parsePersistedUnlinkedMentions } from '../modules/unlinked-mentions/persisted-unlinked-mentions.ts';
import { LocalIndexStorage } from './local-index-storage.ts';
import { SharedHeadingStorage } from './shared-heading-storage.ts';
import { SharedPropertyStorage } from './shared-property-storage.ts';

interface OpenStorage {
  readonly connections: readonly LocalDataStore[];
  readonly shared: null | SharedDataStore;
  readonly storage: IndexStorage;
}

interface PluginIndexStorageConstructorParams {
  readonly app: App;
  readonly getLegacyPath: () => string;
  readonly kind: 'headings' | 'mentions' | 'properties';
  readonly pluginId: string;
}

const COMPACT_AFTER_WRITES = 120;

interface LegacyNotes {
  readonly notes: Readonly<Record<string, unknown>>;
}

interface MergeLegacyIndexParams {
  readonly existing: null | string;
  readonly json: string;
  readonly kind: PluginIndexStorageConstructorParams['kind'];
}

interface PendingLifecycle {
  readonly kind: 'forget' | 'reset';
  readonly path: string;
}

interface PropertyDocument {
  readonly properties: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
}

/**

 * Owns lazy connections, serializes migration and writes, and closes after the last queued operation.

 */
export class PluginIndexStorage implements IndexStorage {
  private readonly lifecycle: PendingLifecycle[] = [];
  private opened: null | OpenStorage = null;
  private readonly params: PluginIndexStorageConstructorParams;
  private queue: Promise<void> = noopAsync();

  private writes = 0;

  public constructor(params: PluginIndexStorageConstructorParams) {
    this.params = params;
  }

  /**

   * Closes connections after every write already requested by the module.

   */
  public async close(): Promise<void> {
    await this.run(() => {
      for (const connection of this.opened?.connections ?? []) {
        connection.close();
      }
      this.opened = null;
      return noopAsync();
    });
  }

  public forget(path: string): void {
    this.lifecycle.push({ kind: 'forget', path });
  }

  public async read(): Promise<null | string> {
    return await this.run(async () => {
      const opened = await this.open();
      return await opened.storage.read();
    });
  }

  public reset(path: string): void {
    this.lifecycle.push({ kind: 'reset', path });
  }

  public async write(json: string): Promise<void> {
    const lifecycle = this.lifecycle.splice(0);
    await this.run(async () => {
      try {
        const opened = await this.open();
        for (const lifecycleEvent of lifecycle) {
          if (lifecycleEvent.kind === 'reset') {
            opened.storage.reset?.(lifecycleEvent.path);
          } else {
            opened.storage.forget?.(lifecycleEvent.path);
          }
        }
        await opened.storage.write(json);
        this.writes++;
        if (this.writes % COMPACT_AFTER_WRITES === 0) {
          await opened.shared?.compact();
        }
      } catch (error) {
        this.lifecycle.unshift(...lifecycle);
        throw error;
      }
    });
  }

  private async open(): Promise<OpenStorage> {
    if (this.opened) {
      return this.opened;
    }
    const { app, kind, pluginId } = this.params;
    const connections: LocalDataStore[] = [];
    async function openLocal(storeId: string): Promise<LocalDataStore> {
      const local = await LocalDataStore.open({ pluginId, storeId, vaultId: app.appId });
      connections.push(local);
      return local;
    }
    try {
      let storage: IndexStorage;
      let shared: null | SharedDataStore = null;
      if (kind === 'headings') {
        const local = await openLocal('heading-observations-v1');
        shared = await SharedDataStore.open({ adapter: app.vault.adapter, kind: 'last-write-wins', local, pluginId, storeId: 'heading-observations-v1' });
        // eslint-disable-next-line n/no-unsupported-features/node-builtins -- This is the renderer Web Crypto API, not Node's crypto global.
        const device = await local.getOrCreate('consumer-device', window.crypto.randomUUID());
        if (typeof device !== 'string') {
          throw new TypeError('Invalid heading writer identity');
        }
        storage = new SharedHeadingStorage({ device, shared });
      } else {
        storage = new LocalIndexStorage({ kind, local: await openLocal(`${kind}-cache-v1`) });
        if (kind === 'properties') {
          const local = await openLocal('property-names-v1');
          shared = await SharedDataStore.open({ adapter: app.vault.adapter, kind: 'minimum', local, pluginId, storeId: 'property-names-v1' });
          storage = new SharedPropertyStorage({ local: storage, names: shared });
        }
      }
      const existing = await storage.read();
      const path = this.params.getLegacyPath();
      if (await app.vault.adapter.exists(path)) {
        const json = await app.vault.adapter.read(path);
        if (!checkLegacyIndex(kind, json)) {
          throw new Error(`Cannot migrate invalid index: ${path}. The original file has been preserved.`);
        }
        const migration = await openLocal(`${kind}-migration-v1`);
        if (await migration.get('imported') !== true) {
          if (storage instanceof SharedHeadingStorage) {
            await storage.importLegacy(json);
          } else {
            await storage.write(mergeLegacyIndex({ existing, json, kind }));
          }
          await migration.set('imported', true);
        }
        await app.vault.adapter.remove(path);
      }
      this.opened = { connections, shared, storage };
      return this.opened;
    } catch (error) {
      for (const connection of connections) {
        connection.close();
      }
      throw error;
    }
  }

  private async run<T>(callback: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(callback);
    this.queue = operation.then(() => undefined).catch(() => undefined);
    return await operation;
  }
}

function checkLegacyIndex(kind: PluginIndexStorageConstructorParams['kind'], json: string): boolean {
  try {
    if (kind === 'headings') {
      const parsed = parsePersistedHeadingTimes(json);
      const source = JSON.parse(json) as LegacyNotes;
      return parsed !== null && Object.keys(parsed.notes).length === Object.keys(source.notes).length;
    }
    if (kind === 'mentions') {
      const parsed = parsePersistedUnlinkedMentions(json);
      const source = JSON.parse(json) as LegacyNotes;
      return parsed !== null && parsed.notes.size === Object.keys(source.notes).length;
    }
    const value: unknown = JSON.parse(json);
    return typeof value === 'object' && value !== null && 'version' in value && value.version === 1 && 'properties' in value
      && typeof value.properties === 'object' && value.properties !== null && Object.values(value.properties).every((paths: unknown) => typeof paths === 'object' && paths !== null && Object.values(paths).every((values: unknown) => Array.isArray(values) && values.every((member: unknown) => typeof member === 'string')));
  } catch {
    return false;
  }
}

function mergeLegacyIndex(params: MergeLegacyIndexParams): string {
  const { existing, json, kind } = params;
  if (existing === null) {
    return json;
  }
  if (kind === 'mentions') {
    return existing;
  }
  const current = JSON.parse(existing) as PropertyDocument;
  const imported = JSON.parse(json) as PropertyDocument;
  const properties = new Map(Object.entries(imported.properties));
  for (const [name, paths] of Object.entries(current.properties)) {
    properties.set(name, { ...properties.get(name), ...paths });
  }
  return JSON.stringify({ properties: Object.fromEntries(properties), version: 1 });
}
