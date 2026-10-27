import type { LocalDataStore } from '@mnaoumov/obsidian-lib/data-stores/local-data-store';

import { noopAsync } from '@mnaoumov/typescript-lib/function';

import type { SavedNoteMentions } from '../modules/unlinked-mentions/persisted-unlinked-mentions.ts';
import type { IndexStorage } from './index-storage.ts';

import {
  parsePersistedUnlinkedMentions,
  stringifyPersistedUnlinkedMentions
} from '../modules/unlinked-mentions/persisted-unlinked-mentions.ts';

interface LocalIndexStorageConstructorParams {
  readonly kind: 'mentions' | 'properties';
  readonly local: LocalDataStore;
}

interface PropertyDocument {
  readonly properties: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  readonly version: number;
}

/**

 * Stores individual records, comparing against the last durable checkpoint.

 */
export class LocalIndexStorage implements IndexStorage {
  private checkpoint = new Map<string, string>();
  private readonly params: LocalIndexStorageConstructorParams;

  private queue: Promise<void> = noopAsync();

  public constructor(params: LocalIndexStorageConstructorParams) {
    this.params = params;
  }

  public async read(): Promise<null | string> {
    await this.queue;
    const entries = await this.params.local.entries();
    this.checkpoint = new Map(entries.map(([key, value]) => [key, JSON.stringify(value) ?? 'null']));
    if (!this.checkpoint.has('version')) {
      return null;
    }
    if (this.params.kind === 'mentions') {
      const notes = entries.flatMap(([key, value]) => key.startsWith('note:') ? [[key.slice('note:'.length), value]] : []);
      return stringifyPersistedUnlinkedMentions({
        cleanKeys: JSON.parse(this.checkpoint.get('cleanKeys') ?? '[]') as string[],
        notes: new Map(notes as [string, SavedNoteMentions][])
      });
    }
    const properties = new Map<string, Map<string, unknown>>();
    for (const [key, value] of entries) {
      if (!key.startsWith('property:')) {
        continue;
      }
      const [name, path] = JSON.parse(key.slice('property:'.length)) as [string, null | string];
      const values = properties.get(name) ?? new Map<string>();
      properties.set(name, values);
      if (path !== null) {
        values.set(path, value);
      }
    }
    return JSON.stringify({ properties: Object.fromEntries([...properties].map(([name, paths]) => [name, Object.fromEntries(paths)])), version: 1 });
  }

  public async write(json: string): Promise<void> {
    const next = this.encode(json);
    const operation = this.queue.then(async () => {
      const entries = [...next].filter(([key, value]) => this.checkpoint.get(key) !== value).map(([key, value]): [string, unknown] => [key, JSON.parse(value)]);
      const removedKeys = [...this.checkpoint.keys()].filter((key) => !next.has(key));
      await this.params.local.commit({ entries, removedKeys });
      this.checkpoint = next;
    });
    this.queue = operation.catch(() => undefined);
    await operation;
  }

  private encode(json: string): Map<string, string> {
    const entries = new Map<string, string>([['version', '1']]);
    if (this.params.kind === 'mentions') {
      const saved = parsePersistedUnlinkedMentions(json);
      if (!saved) {
        throw new Error('Invalid unlinked mentions checkpoint');
      }
      entries.set('cleanKeys', JSON.stringify(saved.cleanKeys));
      for (const [path, note] of saved.notes) {
        entries.set(`note:${path}`, JSON.stringify(note));
      }
    } else {
      const saved = JSON.parse(json) as PropertyDocument;
      if (saved.version !== 1) {
        throw new Error('Invalid property values checkpoint');
      }
      for (const [name, paths] of Object.entries(saved.properties)) {
        entries.set(`property:${JSON.stringify([name, null])}`, 'null');
        for (const [path, values] of Object.entries(paths)) {
          entries.set(`property:${JSON.stringify([name, path])}`, JSON.stringify(values));
        }
      }
    }
    return entries;
  }
}
