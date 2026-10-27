/**
 * Persistence boundary for an index's versioned interchange format.
 */
export interface IndexStorage {
  /**
   * Releases connections after pending writes.
   */
  readonly close?: () => Promise<void>;
  /**
   * Explicitly deletes a tracked note; absence from a stale snapshot is never deletion.
   */
  readonly forget?: (path: string) => void;
  /**
   * Reads a saved index, or `null` when none exists.
   */
  readonly read: () => Promise<null | string>;
  /**
   * Starts a new note incarnation at a reused path.
   */
  readonly reset?: (path: string) => void;
  /**
   * Commits an index before resolving.
   */
  readonly write: (json: string) => Promise<void>;
}
