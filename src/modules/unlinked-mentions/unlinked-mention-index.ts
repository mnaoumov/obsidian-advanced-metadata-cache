import {
  getNameTokens,
  tokenize
} from './word-characters.ts';

interface TrieNode {
  readonly children: Map<string, TrieNode>;
  key: null | string;
}

const KEY_SEPARATOR = ' ';

/**
 * Which notes' text contains which names, so the unlinked mentions of a note are looked for only in the notes that
 * can hold one.
 *
 * Every basename and alias in the vault is a NAME, keyed by its canonical word tokens (`word-characters.ts`). A note's
 * text is scanned once per change against all of them at once, through a trie over those tokens, and the index
 * records which names it contains. The answer is a CANDIDATE set: it is a superset of the notes Obsidian would list,
 * because two names with the same tokens share a key and a name inside a link still counts here, so the caller
 * confirms each candidate with Obsidian's own regular expression.
 *
 * A name that appears after a full scan — a new note, a new alias — is DIRTY: the notes scanned before it existed
 * were not looked at for it. Asking about a dirty name answers `null`, and the caller scans every note, which
 * cleans every name that was dirty when that scan began.
 */
export class UnlinkedMentionIndex {
  private readonly dirtyKeyScanNumbers = new Map<string, number>();
  private readonly keyCounts = new Map<string, number>();
  private readonly keysByNameOwnerPath = new Map<string, string[]>();
  private readonly mentionKeysByPath = new Map<string, Set<string>>();
  private readonly pathsByMentionKey = new Map<string, Set<string>>();
  private root: TrieNode = createTrieNode();
  private scanNumber = 0;

  /**
   * Starts a scan of every note's text. A name that becomes known after this call stays dirty when the scan ends,
   * because the notes the scan had already read were not looked at for it.
   *
   * @returns The marker to pass to {@link UnlinkedMentionIndex.completeFullScan}.
   */
  public beginFullScan(): number {
    this.scanNumber++;
    return this.scanNumber;
  }

  /**
   * Drops everything the index holds.
   */
  public clear(): void {
    this.dirtyKeyScanNumbers.clear();
    this.keyCounts.clear();
    this.keysByNameOwnerPath.clear();
    this.mentionKeysByPath.clear();
    this.pathsByMentionKey.clear();
    this.root = createTrieNode();
  }

  /**
   * Ends a scan of every note's text: every name that was known when it began is now clean.
   *
   * @param marker - What {@link UnlinkedMentionIndex.beginFullScan} returned.
   */
  public completeFullScan(marker: number): void {
    for (const [key, scanNumber] of this.dirtyKeyScanNumbers) {
      if (scanNumber < marker) {
        this.dirtyKeyScanNumbers.delete(key);
      }
    }
  }

  /**
   * Lists the notes whose text may mention any of the names.
   *
   * @param names - The names of one note.
   * @returns The paths, or `null` when one of the names cannot be answered from the index: it has no word character,
   *   it is not a name of any note, or it is dirty. Every note must be read then.
   */
  public getCandidatePaths(names: readonly string[]): null | Set<string> {
    const candidatePaths = new Set<string>();

    for (const name of names) {
      const key = getNameKey(name);
      if (key === null || !this.keyCounts.has(key) || this.dirtyKeyScanNumbers.has(key)) {
        return null;
      }

      for (const path of this.pathsByMentionKey.get(key) ?? []) {
        candidatePaths.add(path);
      }
    }

    return candidatePaths;
  }

  /**
   * Lists the keys every note's text has been looked at for: the names known and not dirty. What a saved index may
   * claim to have scanned for.
   *
   * @returns The keys.
   */
  public getCleanKeys(): string[] {
    return [...this.keyCounts.keys()].filter((key) => !this.dirtyKeyScanNumbers.has(key));
  }

  /**
   * Lists the keys one note's text was found to mention.
   *
   * @param path - The note's path.
   * @returns The keys, empty for a note that mentions none or was never scanned.
   */
  public getMentionKeys(path: string): string[] {
    return [...this.mentionKeysByPath.get(path) ?? []];
  }

  /**
   * Marks names clean without a full scan: for a saved index whose notes were all looked at for them.
   *
   * @param keys - The keys, as {@link UnlinkedMentionIndex.getCleanKeys} listed them when the index was saved.
   */
  public markClean(keys: Iterable<string>): void {
    for (const key of keys) {
      this.dirtyKeyScanNumbers.delete(key);
    }
  }

  /**
   * Forgets the names one note contributed.
   *
   * @param path - The note's path.
   */
  public removeNames(path: string): void {
    this.setNames(path, []);
  }

  /**
   * Forgets the names and the text of every note under a folder.
   *
   * @param folderPath - The folder's path.
   */
  public removeSubtree(folderPath: string): void {
    const prefix = `${folderPath}/`;
    for (const path of this.keysByNameOwnerPath.keys()) {
      if (path.startsWith(prefix)) {
        this.removeNames(path);
      }
    }

    for (const path of this.mentionKeysByPath.keys()) {
      if (path.startsWith(prefix)) {
        this.removeText(path);
      }
    }
  }

  /**
   * Forgets what one note's text mentions.
   *
   * @param path - The note's path.
   */
  public removeText(path: string): void {
    this.replaceMentionKeys(path, new Set());
  }

  /**
   * Moves what a note's text mentions to its new path. Its names move with {@link UnlinkedMentionIndex.setNames},
   * because a rename changes its basename.
   *
   * @param oldPath - The path it had.
   * @param newPath - The path it has.
   */
  public renameText(oldPath: string, newPath: string): void {
    const mentionKeys = this.mentionKeysByPath.get(oldPath);
    this.removeText(oldPath);
    if (mentionKeys) {
      this.replaceMentionKeys(newPath, mentionKeys);
    }
  }

  /**
   * Records what one note's text was found to mention by an earlier scan, saved, without reading it again. A key that
   * is no longer a name is dropped: nothing could ask for it.
   *
   * @param path - The note's path.
   * @param mentionKeys - The keys {@link UnlinkedMentionIndex.getMentionKeys} listed for it.
   */
  public restoreText(path: string, mentionKeys: readonly string[]): void {
    this.replaceMentionKeys(path, new Set(mentionKeys.filter((key) => this.keyCounts.has(key))));
  }

  /**
   * Records the names one note answers to, replacing the ones it answered to before.
   *
   * @param path - The note's path.
   * @param names - Its basename and aliases.
   */
  public setNames(path: string, names: readonly string[]): void {
    const newKeys = [...new Set(names.map((name) => getNameKey(name)).filter((key) => key !== null))];
    const oldKeys = this.keysByNameOwnerPath.get(path) ?? [];

    if (newKeys.length === 0) {
      this.keysByNameOwnerPath.delete(path);
    } else {
      this.keysByNameOwnerPath.set(path, newKeys);
    }

    for (const key of newKeys) {
      this.addKey(key);
    }

    for (const key of oldKeys) {
      this.removeKey(key);
    }
  }

  /**
   * Scans one note's text for every known name, replacing what it was found to mention before.
   *
   * @param path - The note's path.
   * @param text - Its text.
   */
  public setText(path: string, text: string): void {
    const tokens = tokenize(text);
    const mentionKeys = new Set<string>();

    for (const [start, token] of tokens.entries()) {
      let node = this.root.children.get(token);
      for (let index = start + 1; node; index++) {
        if (node.key !== null) {
          mentionKeys.add(node.key);
        }

        node = node.children.get(tokens[index] ?? '');
      }
    }

    this.replaceMentionKeys(path, mentionKeys);
  }

  private addKey(key: string): void {
    const count = this.keyCounts.get(key) ?? 0;
    this.keyCounts.set(key, count + 1);
    if (count > 0) {
      return;
    }

    let node = this.root;
    for (const token of key.split(KEY_SEPARATOR)) {
      let child = node.children.get(token);
      if (!child) {
        child = createTrieNode();
        node.children.set(token, child);
      }

      node = child;
    }

    node.key = key;
    this.dirtyKeyScanNumbers.set(key, this.scanNumber);
  }

  private removeKey(key: string): void {
    /* v8 ignore start -- Only a key this index holds is ever removed. */
    const count = this.keyCounts.get(key) ?? 0;
    /* v8 ignore stop */
    if (count > 1) {
      this.keyCounts.set(key, count - 1);
      return;
    }

    this.keyCounts.delete(key);
    this.dirtyKeyScanNumbers.delete(key);
    checkIsEmptyAfterRemoving(this.root, key.split(KEY_SEPARATOR), 0);

    for (const path of this.pathsByMentionKey.get(key) ?? []) {
      const mentionKeys = this.mentionKeysByPath.get(path);
      mentionKeys?.delete(key);
      if (mentionKeys?.size === 0) {
        this.mentionKeysByPath.delete(path);
      }
    }

    this.pathsByMentionKey.delete(key);
  }

  private replaceMentionKeys(path: string, mentionKeys: ReadonlySet<string>): void {
    const oldMentionKeys = this.mentionKeysByPath.get(path) ?? new Set<string>();

    for (const key of oldMentionKeys) {
      if (mentionKeys.has(key)) {
        continue;
      }

      const paths = this.pathsByMentionKey.get(key);
      paths?.delete(path);
      if (paths?.size === 0) {
        this.pathsByMentionKey.delete(key);
      }
    }

    for (const key of mentionKeys) {
      if (oldMentionKeys.has(key)) {
        continue;
      }

      let paths = this.pathsByMentionKey.get(key);
      if (!paths) {
        paths = new Set();
        this.pathsByMentionKey.set(key, paths);
      }

      paths.add(path);
    }

    if (mentionKeys.size === 0) {
      this.mentionKeysByPath.delete(path);
    } else {
      this.mentionKeysByPath.set(path, new Set(mentionKeys));
    }
  }
}

/**
 * The key a name is indexed by: its canonical word tokens, space-joined.
 *
 * @param name - A basename or an alias.
 * @returns The key, or `null` when the name cannot be indexed.
 */
export function getNameKey(name: string): null | string {
  return getNameTokens(name)?.join(KEY_SEPARATOR) ?? null;
}

/*
 * Returns whether the node is now empty, so its parent can drop it: a trie that only ever grew would keep every name
 * the vault ever had.
 */
function checkIsEmptyAfterRemoving(node: TrieNode, tokens: readonly string[], index: number): boolean {
  if (index === tokens.length) {
    node.key = null;
  } else {
    /* v8 ignore start -- The index is within the tokens here. */
    const token = tokens[index] ?? '';
    /* v8 ignore stop */
    const child = node.children.get(token);
    if (child && checkIsEmptyAfterRemoving(child, tokens, index + 1)) {
      node.children.delete(token);
    }
  }

  return node.key === null && node.children.size === 0;
}

function createTrieNode(): TrieNode {
  return { children: new Map(), key: null };
}
