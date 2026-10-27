import type { SharedDataStore } from '@mnaoumov/obsidian-lib/data-stores/shared-data-store';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';

import type { NoteHeadingTimes } from '../modules/headings/heading-times-index.ts';
import type { IndexStorage } from './index-storage.ts';

import {
  isNoteHeadingTimes,
  mergeHeadingNotes,
  parsePersistedHeadingTimes
} from '../modules/headings/heading-times-index.ts';

/**

 * One writer's latest observation of one path, including its incarnation boundary.

 */
export interface HeadingObservation {
  readonly changedAt: number;
  readonly note: NoteHeadingTimes | null;
  readonly path: string;
  readonly resetAt: number;
}

interface ActiveHeadingObservation extends HeadingObservation {
  readonly note: NoteHeadingTimes;
}

interface SharedHeadingStorageConstructorParams {
  readonly device: string;
  readonly shared: SharedDataStore;
}

/**

 * Per-writer snapshots retain concurrent observations instead of overwriting another device's times.

 */
export class SharedHeadingStorage implements IndexStorage {
  private checkpoint = new Map<string, string>();
  private readonly epochs = new Map<string, number>();
  private readonly params: SharedHeadingStorageConstructorParams;
  private queue: Promise<void> = noopAsync();
  private readonly removedPaths = new Set<string>();

  private time = 0;

  public constructor(params: SharedHeadingStorageConstructorParams) {
    this.params = params;
  }

  public forget(path: string): void {
    this.epochs.set(path, this.tick());
    this.removedPaths.add(path);
    this.checkpoint.delete(path);
  }

  /**

   * Imports observations without replacing live records or resurrecting deleted incarnations.

   */
  public async importLegacy(json: string): Promise<void> {
    const persisted = parsePersistedHeadingTimes(json);
    if (!persisted) {
      throw new Error('Invalid legacy heading history');
    }
    await this.params.shared.setMany(
      Object.entries(persisted.notes).map(([path, note]) => [
        JSON.stringify([this.params.device, 'legacy', path]),
        { changedAt: 0, note: { ...note, headings: note.headings.map((heading) => ({ ...heading })) }, path, resetAt: 0 }
      ])
    );
  }

  public async read(): Promise<string> {
    await this.queue;
    await this.params.shared.synchronize();
    const observations = this.params.shared.entries().flatMap(([, value]) => isHeadingObservation(value) ? [value] : []);
    for (const observation of observations) {
      this.time = Math.max(this.time, observation.changedAt, observation.resetAt);
      this.epochs.set(observation.path, Math.max(this.epochs.get(observation.path) ?? 0, observation.resetAt));
    }
    const notes = mergeHeadingObservations(observations);
    this.checkpoint = new Map(Object.entries(notes).map(([path, note]) => [path, JSON.stringify(note)]));
    return JSON.stringify({ notes, version: 1 });
  }

  public reset(path: string): void {
    if (!this.checkpoint.has(path) && !this.epochs.has(path)) {
      return;
    }
    this.epochs.set(path, this.tick());
    this.checkpoint.delete(path);
    this.removedPaths.delete(path);
  }

  public async write(json: string): Promise<void> {
    const persisted = parsePersistedHeadingTimes(json);
    if (!persisted) {
      throw new Error('Invalid heading history checkpoint');
    }
    const next = new Map(Object.entries(persisted.notes).map(([path, note]) => [path, JSON.stringify(note)]));
    const epochs = new Map(this.epochs);
    const removedPaths = [...this.removedPaths];
    const operation = this.queue.then(async () => {
      const writes = [...next].filter(([path, note]) => note !== this.checkpoint.get(path)).map(([path, note]): [string, HeadingObservation] => [
        JSON.stringify([this.params.device, path]),
        { changedAt: this.tick(), note: JSON.parse(note) as NoteHeadingTimes, path, resetAt: epochs.get(path) ?? 0 }
      ]);
      for (const path of removedPaths) {
        if (next.has(path)) {
          continue;
        }

        writes.push([JSON.stringify([this.params.device, path]), { changedAt: this.tick(), note: null, path, resetAt: ensureNonNullable(epochs.get(path)) }]);
      }
      await this.params.shared.setMany(writes.map(([key, value]) => [key, { ...value, note: value.note === null ? null : { ...value.note, headings: value.note.headings.map((heading) => ({ ...heading })) } }]));
      this.checkpoint = next;
      for (const path of removedPaths) {
        this.removedPaths.delete(path);
      }
    });
    this.queue = operation.catch(() => undefined);
    await operation;
  }

  private tick(): number {
    this.time = Math.max(Date.now(), this.time + 1);
    return this.time;
  }
}

/**
 * Resolves concurrent first observations and ignores snapshots from a deleted/recreated incarnation.
 */
export function mergeHeadingObservations(observations: readonly HeadingObservation[]): Record<string, NoteHeadingTimes> {
  const groups = new Map<string, HeadingObservation[]>();
  // eslint-disable-next-line unicorn/prefer-group-by -- Obsidian's supported ES2022 hosts do not provide Map.groupBy.
  for (const observation of observations) {
    const group = groups.get(observation.path) ?? [];
    group.push(observation);
    groups.set(observation.path, group);
  }
  const notes: Record<string, NoteHeadingTimes> = {};
  for (const [path, group] of groups) {
    const epoch = Math.max(...group.map((entry) => entry.resetAt));
    const active = group.filter((entry): entry is ActiveHeadingObservation => entry.resetAt === epoch && entry.note !== null).sort((left, right) => right.note.mtime - left.note.mtime || right.changedAt - left.changedAt || compareObservation(left, right));
    let note = active[0]?.note;
    if (!note) {
      continue;
    }
    for (const observation of active.slice(1)) {
      note = mergeHeadingNotes(note, observation.note);
    }
    notes[path] = note;
  }
  return notes;
}

function compareObservation(left: HeadingObservation, right: HeadingObservation): number {
  const leftJson = JSON.stringify(left);
  const rightJson = JSON.stringify(right);
  return leftJson === rightJson ? 0 : (leftJson < rightJson ? -1 : 1);
}

function isHeadingObservation(value: unknown): value is HeadingObservation {
  return typeof value === 'object' && value !== null && ('path' in value) && typeof value.path === 'string' && ('changedAt' in value) && typeof value.changedAt === 'number' && Number.isFinite(value.changedAt) && ('resetAt' in value) && typeof value.resetAt === 'number' && Number.isFinite(value.resetAt) && ('note' in value) && (value.note === null || isNoteHeadingTimes(value.note));
}
