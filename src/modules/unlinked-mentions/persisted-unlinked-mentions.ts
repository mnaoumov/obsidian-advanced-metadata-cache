/**
 * What `unlinked-mentions.json` holds for one note: the `mtime` and `size` its text had when it was scanned, and the
 * keys it was found to mention, as indexes into {@link PersistedUnlinkedMentions.keys}.
 */
export interface PersistedNoteMentions {
  readonly keys: readonly number[];
  readonly mtime: number;
  readonly size: number;
}

/**
 * The saved `Unlinked mentions` index.
 *
 * Every key is written once, in {@link PersistedUnlinkedMentions.keys}, and referred to by its position, because a
 * name a vault mentions often would otherwise be written once per note that mentions it.
 */
export interface PersistedUnlinkedMentions {
  /**
   * The keys every saved note was looked at for, as indexes into {@link PersistedUnlinkedMentions.keys}. A key left
   * out was dirty when the index was saved, and is dirty again when it is loaded.
   */
  readonly cleanKeys: readonly number[];
  readonly keys: readonly string[];
  readonly notes: Readonly<Record<string, PersistedNoteMentions>>;
  readonly version: number;
}

/**
 * What one note's saved entry says, with its keys spelled out.
 */
export interface SavedNoteMentions {
  readonly mentionKeys: readonly string[];
  readonly mtime: number;
  readonly size: number;
}

/**
 * The saved index, with its keys spelled out.
 */
export interface SavedUnlinkedMentions {
  readonly cleanKeys: readonly string[];
  readonly notes: ReadonlyMap<string, SavedNoteMentions>;
}

/*
 * Bumped whenever what a key means changes, `word-characters.ts`'s tokenizing above all: a file saved under another
 * version is ignored, and the index is built by reading every note.
 */
const PERSISTED_VERSION = 1;

/**
 * Reads a saved index.
 *
 * @param json - The file's text.
 * @returns The index, or `null` when the file is not one this version wrote; an entry that is malformed is dropped,
 *   so its note is read again.
 */
export function parsePersistedUnlinkedMentions(json: string): null | SavedUnlinkedMentions {
  let value: unknown;

  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }

  const persisted = value as null | Partial<Record<keyof PersistedUnlinkedMentions, unknown>>;
  if (
    persisted?.version !== PERSISTED_VERSION
    || !isStringArray(persisted.keys)
    || !Array.isArray(persisted.cleanKeys)
    || typeof persisted.notes !== 'object'
    || persisted.notes === null
  ) {
    return null;
  }

  const keys = persisted.keys;
  const cleanKeys = getKeysAt(keys, persisted.cleanKeys);
  if (!cleanKeys) {
    return null;
  }

  const notes = new Map<string, SavedNoteMentions>();
  for (const [path, note] of Object.entries(persisted.notes)) {
    const entry = note as null | Partial<Record<keyof PersistedNoteMentions, unknown>>;
    const mentionKeys = getKeysAt(keys, entry?.keys);
    if (mentionKeys && typeof entry?.mtime === 'number' && typeof entry.size === 'number') {
      notes.set(path, { mentionKeys, mtime: entry.mtime, size: entry.size });
    }
  }

  return { cleanKeys, notes };
}

/**
 * Writes an index for saving.
 *
 * @param saved - The index, with its keys spelled out.
 * @returns The file's text.
 */
export function stringifyPersistedUnlinkedMentions(saved: SavedUnlinkedMentions): string {
  const keyIndexes = new Map<string, number>();
  const cleanKeys = saved.cleanKeys.map((key) => getKeyIndex(keyIndexes, key));
  const notes: Record<string, PersistedNoteMentions> = {};
  for (const [path, note] of saved.notes) {
    notes[path] = { keys: note.mentionKeys.map((key) => getKeyIndex(keyIndexes, key)), mtime: note.mtime, size: note.size };
  }

  const persisted: PersistedUnlinkedMentions = {
    cleanKeys,
    keys: [...keyIndexes.keys()],
    notes,
    version: PERSISTED_VERSION
  };
  return JSON.stringify(persisted);
}

// The position a key is written at, giving it the next one the first time it is seen.
function getKeyIndex(keyIndexes: Map<string, number>, key: string): number {
  let index = keyIndexes.get(key);
  if (index === undefined) {
    index = keyIndexes.size;
    keyIndexes.set(key, index);
  }

  return index;
}

// The keys a list of positions names, or `null` when it is not a list or names a position past the end.
function getKeysAt(keys: readonly string[], indexes: unknown): null | string[] {
  if (!Array.isArray(indexes)) {
    return null;
  }

  const result: string[] = [];
  for (const index of indexes) {
    const key = typeof index === 'number' ? keys[index] : undefined;
    if (key === undefined) {
      return null;
    }

    result.push(key);
  }

  return result;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
