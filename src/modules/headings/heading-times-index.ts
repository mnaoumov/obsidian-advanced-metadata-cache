/**
 * @file
 *
 * The state behind the `Headings` module: for each tracked note, its headings as last parsed and when each
 * was created, last modified and last seen.
 *
 * Kept in shared observation journals with a local IndexedDB replica, never in the note. A note is tracked from the first
 * time it is opened, changed or created while the module is on, so a vault nobody is working in costs
 * nothing and there is no up-front walk of it. A heading that was already there when its note started
 * being tracked has `created` and `modified` of `null`: the plugin did not see it happen, and a guessed
 * time would be one a sort trusts.
 *
 * Owned by the plugin rather than by the module's component, like the title index, because the published
 * API reads it for the plugin's whole life; it gates itself on the module's toggle.
 */

import type {
  App,
  TFile
} from 'obsidian';

import type { IndexStorage } from '../../persistence/index-storage.ts';
import type { HeadingTimes } from '../../plugin-api.ts';
import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';
import type { HeadingSnapshot } from './heading-snapshot.ts';

import { FileIndexStorage } from '../../persistence/file-index-storage.ts';
import { matchHeadings } from './heading-snapshot.ts';

/**
 * One tracked heading: its last parse and its three times.
 */
export interface HeadingTimesRecord extends HeadingSnapshot {
  readonly created: null | number;
  readonly modified: null | number;
  readonly seen: null | number;
}

/**
 * One tracked note.
 */
export interface NoteHeadingTimes {
  /**
   * The note's headings as last parsed, in document order.
   */
  readonly headings: readonly HeadingTimesRecord[];

  /**
   * The note's `mtime` when they were parsed: a note whose `mtime` has moved since was changed while
   * nothing was watching.
   */
  readonly mtime: number;
}

interface AdvanceHeadingTimesParams {
  /**
   * The note's records before this parse, or `null` when the note was not tracked yet.
   */
  readonly previous: null | readonly HeadingTimesRecord[];
  readonly snapshots: readonly HeadingSnapshot[];
  readonly time: number;
}

interface HeadingTimesIndexConstructorParams {
  readonly app: App;
  readonly getDataFilePath: () => string;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly storage?: IndexStorage;
}

interface HeadingTimesIndexMarkSeenParams {
  readonly fromLine: number;
  readonly path: string;
  readonly time: number;
  readonly toLine: number;
}

interface HeadingTimesIndexRecordParams {
  readonly mtime: number;
  readonly path: string;
  readonly snapshots: readonly HeadingSnapshot[];
  readonly time: number;
}

interface PersistedHeadingTimes {
  readonly notes: Record<string, NoteHeadingTimes>;
  readonly version: typeof PERSISTED_VERSION;
}

const PERSISTED_VERSION = 1;

/**
 * Answers when a note's headings were created, modified and seen.
 */
export class HeadingTimesIndex {
  /**
   * Whether anything changed since the last save.
   */
  public get isDirty(): boolean {
    return this.isDirtyValue;
  }

  private readonly app: App;
  private generation = 0;
  private readonly getDataFilePath: () => string;
  private isDirtyValue = false;
  private readonly missingPaths = new Set<string>();
  private readonly notes = new Map<string, NoteHeadingTimes>();
  private readonly pathRevisions = new Map<string, number>();
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private revision = 0;
  private readonly storage: IndexStorage;

  public constructor(params: HeadingTimesIndexConstructorParams) {
    this.app = params.app;
    this.getDataFilePath = params.getDataFilePath;
    this.storage = params.storage ?? new FileIndexStorage({ adapter: this.app.vault.adapter, getPath: this.getDataFilePath });
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  /**
   * Forgets everything held in memory. The file on disk is left alone, so switching the module off and on
   * again loses no history.
   */
  public clear(): void {
    this.revision++;
    this.generation++;
    this.pathRevisions.clear();
    this.notes.clear();
    this.missingPaths.clear();
    this.isDirtyValue = false;
  }

  /**

   * Releases persistence after every save already requested by the component.

   */
  public async close(): Promise<void> {
    await this.storage.close?.();
  }

  /**
   * Forgets one note.
   *
   * @param path - The note's vault-relative path.
   */
  public delete(path: string): void {
    this.revision++;
    this.pathRevisions.set(path, this.revision);
    if (this.notes.has(path)) {
      this.storage.forget?.(path);
    }
    this.isDirtyValue = this.notes.delete(path) || this.isDirtyValue;
    this.missingPaths.delete(path);
  }

  /**
   * Forgets every note under a folder.
   *
   * @param folderPath - The folder's vault-relative path.
   */
  public deleteSubtree(folderPath: string): void {
    for (const path of this.getPathsUnder(folderPath)) {
      this.delete(path);
    }
  }

  /**
   * Reads one note's tracked state.
   *
   * @param path - The note's vault-relative path.
   * @returns Its state, or `undefined` when it is not tracked.
   */
  public get(path: string): NoteHeadingTimes | undefined {
    return this.notes.get(path);
  }

  /**
   * Answers the published question: when were this note's headings created, modified and seen?
   *
   * @param file - The note.
   * @returns Its headings in document order. A note not tracked yet answers its current headings with
   *   every time `null`. Empty while the `Headings` module is off.
   */
  public getHeadingTimes(file: TFile): HeadingTimes[] {
    if (!this.pluginSettingsComponent.settings.isHeadingsModuleEnabled) {
      return [];
    }

    const note = this.notes.get(file.path);

    if (note) {
      return note.headings.map((heading) => ({
        created: heading.created,
        heading: heading.text,
        level: heading.level,
        line: heading.line,
        modified: heading.modified,
        seen: heading.seen
      }));
    }

    return (this.app.metadataCache.getFileCache(file)?.headings ?? []).map((headingCache) => ({
      created: null,
      heading: headingCache.heading,
      level: headingCache.level,
      line: headingCache.position.start.line,
      modified: null,
      seen: null
    }));
  }

  /**
   * Lists every tracked note.
   *
   * @returns Their vault-relative paths.
   */
  public getPaths(): string[] {
    return [...this.notes.keys()];
  }

  /**
   * Reads persisted history, preserving paths changed while the load is in flight.
   */
  public async load(): Promise<void> {
    this.clear();
    const revision = this.revision;
    const generation = this.generation;
    const json = await this.storage.read();
    if (json === null || generation !== this.generation) {
      return;
    }
    const persisted = parsePersistedHeadingTimes(json);

    for (const [path, note] of Object.entries(persisted?.notes ?? {})) {
      if ((this.pathRevisions.get(path) ?? 0) <= revision) {
        this.notes.set(path, note);
      }
    }
  }

  /**

   * Keeps dormant history when a journal arrives before its note.

   */
  public markMissing(path: string): void {
    this.missingPaths.add(path);
  }

  /**
   * Stamps every heading whose own section overlaps a line range as seen.
   *
   * @param params - The note, the range and the time.
   */
  public markSeen(params: HeadingTimesIndexMarkSeenParams): void {
    const { fromLine, path, time, toLine } = params;
    const note = this.notes.get(path);

    if (!note) {
      return;
    }

    const headings = note.headings.map((heading, index) => {
      const sectionEndLine = (note.headings[index + 1]?.line ?? Infinity) - 1;

      const isOnScreen = heading.line <= toLine && sectionEndLine >= fromLine;
      return isOnScreen && heading.seen !== time ? { ...heading, seen: time } : heading;
    });

    if (headings.some((heading, index) => heading !== note.headings[index])) {
      this.set(path, { headings, mtime: note.mtime });
    }
  }

  /**
   * Records a new parse of a note, carrying each heading's times over from the heading it continues.
   *
   * @param params - The note, its new parse, its `mtime` and the time to stamp changes with.
   */
  public record(params: HeadingTimesIndexRecordParams): void {
    const { mtime, path, snapshots, time } = params;
    this.set(path, {
      headings: advanceHeadingTimes({ previous: this.notes.get(path)?.headings ?? null, snapshots, time }),
      mtime
    });
  }

  /**
   * Moves one note's state to its new path.
   *
   * @param oldPath - The path it had.
   * @param newPath - The path it has.
   */
  public rename(oldPath: string, newPath: string): void {
    const note = this.notes.get(oldPath);

    if (!note) {
      return;
    }

    this.notes.delete(oldPath);
    this.pathRevisions.set(oldPath, this.revision + 1);
    this.storage.forget?.(oldPath);
    this.storage.reset?.(newPath);
    this.set(newPath, note);
  }

  /**
   * Moves the state of every note under a folder to the folder's new path.
   *
   * @param oldFolderPath - The path the folder had.
   * @param newFolderPath - The path it has.
   */
  public renameSubtree(oldFolderPath: string, newFolderPath: string): void {
    for (const oldPath of this.getPathsUnder(oldFolderPath)) {
      this.rename(oldPath, `${newFolderPath}${oldPath.slice(oldFolderPath.length)}`);
    }
  }

  /**

   * Resumes dormant history on sync delivery; an ordinary create starts empty instead.

   */
  public resumeMissing(path: string): boolean {
    return this.missingPaths.delete(path);
  }

  /**
   * Writes the state to disk.
   *
   * The JSON is built synchronously, before the first `await`, so a caller may clear the index straight
   * after calling this and still have the state it held saved.
   */
  public async save(): Promise<void> {
    const persisted: PersistedHeadingTimes = {
      notes: Object.fromEntries(this.notes),
      version: PERSISTED_VERSION
    };
    const json = JSON.stringify(persisted);
    const revision = this.revision;
    await this.storage.write(json);
    if (revision === this.revision) {
      this.isDirtyValue = false;
    }
  }

  /**

   * Merges arriving observations without replacing a parse recorded while synchronization awaited I/O.

   */
  public async synchronize(): Promise<void> {
    const generation = this.generation;
    if (this.isDirtyValue) {
      await this.save();
    }
    if (generation !== this.generation) {
      return;
    }
    const revision = this.revision;
    const json = await this.storage.read();
    if (json === null || revision !== this.revision) {
      return;
    }
    const persisted = parsePersistedHeadingTimes(json);
    if (!persisted) {
      return;
    }
    for (const [path, observed] of Object.entries(persisted.notes)) {
      const current = this.notes.get(path);
      this.notes.set(path, current ? mergeHeadingNotes(current, observed) : observed);
      if (!this.app.vault.getFileByPath(path)) {
        this.markMissing(path);
      }
    }
    for (const path of this.notes.keys()) {
      if (!Object.hasOwn(persisted.notes, path)) {
        this.notes.delete(path);
      }
    }
  }

  /**
   * Starts tracking a note with no headings, so every heading it gains is stamped as created.
   *
   * For a note created while the module is on: unlike a note merely opened, there is nothing it had before.
   * Whatever was held for the path is dropped, because it belonged to a note that is no longer there.
   *
   * @param path - The new note's vault-relative path.
   * @param mtime - Its `mtime`.
   */
  public trackEmpty(path: string, mtime: number): void {
    this.storage.reset?.(path);
    this.set(path, { headings: [], mtime });
  }

  private getPathsUnder(folderPath: string): string[] {
    const prefix = `${folderPath}/`;
    return this.getPaths().filter((path) => path.startsWith(prefix));
  }

  private set(path: string, note: NoteHeadingTimes): void {
    this.revision++;
    this.pathRevisions.set(path, this.revision);
    this.notes.set(path, note);
    this.isDirtyValue = true;
  }
}

/**
 * Builds a note's new records out of its previous ones and a new parse.
 *
 * A heading that continues an old one keeps its `created` and `seen`, and keeps its `modified` unless its
 * section's text changed. A heading that continues nothing was created now. A note not tracked before has
 * nothing to compare with, so every heading starts with no times at all.
 *
 * @param params - The previous records, the new parse and the time to stamp with.
 * @returns The new records, in document order.
 */
export function advanceHeadingTimes(params: AdvanceHeadingTimesParams): HeadingTimesRecord[] {
  const { previous, snapshots, time } = params;

  if (!previous) {
    return snapshots.map((snapshot) => ({ ...snapshot, created: null, modified: null, seen: null }));
  }

  const matches = matchHeadings(previous, snapshots);

  return snapshots.map((snapshot, index) => {
    const matchIndex = matches.get(index);
    const oldRecord = matchIndex === undefined ? undefined : previous[matchIndex];

    if (!oldRecord) {
      return { ...snapshot, created: time, modified: time, seen: null };
    }

    return {
      ...snapshot,
      created: oldRecord.created,
      modified: oldRecord.subtreeHash === snapshot.subtreeHash ? oldRecord.modified : time,
      seen: oldRecord.seen
    };
  });
}

export function isNoteHeadingTimes(value: unknown): value is NoteHeadingTimes {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const note = value as Partial<Record<keyof NoteHeadingTimes, unknown>>;
  return typeof note.mtime === 'number' && Array.isArray(note.headings) && note.headings.every(isHeadingTimesRecord);
}

export function mergeHeadingNotes(current: NoteHeadingTimes, observed: NoteHeadingTimes): NoteHeadingTimes {
  const matches = matchHeadings(observed.headings, current.headings);
  return {
    ...current,
    headings: current.headings.map((heading, index) => {
      const otherIndex = matches.get(index);
      const other = otherIndex === undefined ? undefined : observed.headings[otherIndex];
      if (!other) {
        return heading;
      }
      return {
        ...heading,
        created: mergeTime(heading.created, other.created, Math.min),
        modified: mergeTime(heading.modified, other.modified, Math.max),
        seen: mergeTime(heading.seen, other.seen, Math.max)
      };
    })
  };
}

/**
 * Reads the saved file, keeping every note whose entry is well-formed and dropping the rest.
 *
 * @param json - The file's text.
 * @returns The saved state, or `null` when the file is not this format at all.
 */
export function parsePersistedHeadingTimes(json: string): null | PersistedHeadingTimes {
  let value: unknown;

  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }

  const persisted = value as null | Partial<Record<keyof PersistedHeadingTimes, unknown>>;

  if (persisted?.version !== PERSISTED_VERSION || typeof persisted.notes !== 'object' || persisted.notes === null) {
    return null;
  }

  return {
    notes: Object.fromEntries(Object.entries(persisted.notes).flatMap(([path, note]: [string, unknown]): [string, NoteHeadingTimes][] => isNoteHeadingTimes(note) ? [[path, note]] : [])),
    version: PERSISTED_VERSION
  };
}

function isHeadingTimesRecord(value: unknown): value is HeadingTimesRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Partial<Record<keyof HeadingTimesRecord, unknown>>;
  return typeof record.bodyHash === 'string'
    && typeof record.level === 'number'
    && typeof record.line === 'number'
    && typeof record.subtreeHash === 'string'
    && typeof record.text === 'string'
    && isTime(record.created)
    && isTime(record.modified)
    && isTime(record.seen);
}

function isTime(value: unknown): value is null | number {
  return value === null || typeof value === 'number';
}

function mergeTime(left: null | number, right: null | number, merge: (...values: number[]) => number): null | number {
  return left === null ? right : (right === null ? left : merge(left, right));
}
