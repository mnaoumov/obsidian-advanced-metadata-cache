/**
 * @file
 *
 * The data behind the `Link texts` module: for every file, the display texts that the links pointing at it
 * use instead of its own name. `[alpha](bravo.md)` and `[[bravo|alpha]]` make `bravo.md` answer to `alpha`, and
 * `![[IMG_2231.jpg|boarding pass]]` makes an image answer to `boarding pass`, which for an attachment is the only
 * name it has besides its file name.
 *
 * Kept twice on purpose: by TARGET, which is what a query asks, and by SOURCE, which is what an event names. A
 * note that changes replaces its own contributions wholesale, and the by-source half is what lets the replacement
 * say which targets it actually changed, so a consumer re-reads those and nothing else.
 *
 * Owned by the plugin rather than by the module's component, for the reason `TitleIndex` is: a consumer subscribes
 * to its changes once, for the plugin's whole life, and the module may be switched off and on under it.
 */

/**
 * One link's contribution: the file it points at, and the display text it shows instead of that file's name.
 */
export interface LinkTextContribution {
  readonly targetPath: string;
  readonly text: string;
}

/**
 * One distinct display text of a file, as the API reports it.
 */
export interface LinkTextEntry {
  readonly count: number;
  readonly sourcePaths: string[];
  readonly text: string;
}

/**
 * Called with the target paths whose link texts changed, or `null` when any of them may have: the index was
 * built, or cleared.
 */
export type LinkTextsChangedListener = (targetPaths: null | string[]) => void;

/**
 * The per-target and per-source maps, and the listeners told when they change.
 */
export class LinkTextIndex {
  private readonly bySource = new Map<string, readonly LinkTextContribution[]>();
  // Target path -> text -> source path -> how many links of that source use the text.
  private readonly byTarget = new Map<string, Map<string, Map<string, number>>>();
  private readonly listeners = new Set<LinkTextsChangedListener>();

  /**
   * Forgets everything, and tells the listeners so.
   */
  public clear(): void {
    const wasEmpty = this.bySource.size === 0;
    this.bySource.clear();
    this.byTarget.clear();

    if (!wasEmpty) {
      this.notify(null);
    }
  }

  /**
   * Removes one source's contributions, for a note that was deleted or moved away.
   *
   * @param sourcePath - The source note's path.
   * @returns The target paths whose texts changed.
   */
  public deleteSource(sourcePath: string): string[] {
    return this.setSource(sourcePath, []);
  }

  /**
   * Reads one file's link texts.
   *
   * @param targetPath - The file's path.
   * @returns Its distinct texts, the most used first, then in code-unit order; each with its sources in code-unit
   *   order. Empty for a file no link names differently.
   */
  public getLinkTexts(targetPath: string): LinkTextEntry[] {
    const texts = this.byTarget.get(targetPath);

    if (!texts) {
      return [];
    }

    const entries: LinkTextEntry[] = [];

    for (const [text, sources] of texts) {
      let count = 0;

      for (const sourceCount of sources.values()) {
        count += sourceCount;
      }

      entries.push({ count, sourcePaths: [...sources.keys()].sort(compareByCodeUnits), text });
    }

    return entries.sort((a, b) => b.count - a.count || compareByCodeUnits(a.text, b.text));
  }

  /**
   * Lists the indexed sources at a path or, for a folder, under it.
   *
   * @param path - A file or folder path.
   * @param isFolderPath - Whether the path is a folder's.
   * @returns The source paths.
   */
  public getSourcePaths(path: string, isFolderPath: boolean): string[] {
    return [...this.bySource.keys()].filter((sourcePath) => isAtOrUnder(sourcePath, path, isFolderPath));
  }

  /**
   * Lists the sources linking to a target at a path or, for a folder, to any target under it.
   *
   * @param path - A file or folder path.
   * @param isFolderPath - Whether the path is a folder's.
   * @returns The source paths, each once.
   */
  public getSourcePathsLinkingTo(path: string, isFolderPath: boolean): string[] {
    const sourcePaths = new Set<string>();

    for (const [targetPath, texts] of this.byTarget) {
      if (!isAtOrUnder(targetPath, path, isFolderPath)) {
        continue;
      }

      for (const sources of texts.values()) {
        for (const sourcePath of sources.keys()) {
          sourcePaths.add(sourcePath);
        }
      }
    }

    return [...sourcePaths];
  }

  /**
   * Tells the listeners which targets changed.
   *
   * @param targetPaths - The changed target paths, or `null` for any of them.
   */
  public notify(targetPaths: null | string[]): void {
    if (targetPaths?.length === 0) {
      return;
    }

    for (const listener of this.listeners) {
      try {
        listener(targetPaths === null ? null : [...targetPaths]);
      } catch (error) {
        // One consumer's bug must not keep the others uninformed.
        console.error(error);
      }
    }
  }

  /**
   * Subscribes to changes.
   *
   * @param listener - Called after each change.
   * @returns A function that unsubscribes it.
   */
  public onChange(listener: LinkTextsChangedListener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Replaces one source's contributions.
   *
   * @param sourcePath - The source note's path.
   * @param contributions - Everything its links now contribute.
   * @returns The target paths whose texts changed, compared through this source alone.
   */
  public setSource(sourcePath: string, contributions: readonly LinkTextContribution[]): string[] {
    const previous = this.bySource.get(sourcePath) ?? [];

    for (const { targetPath, text } of previous) {
      this.removeOne(sourcePath, targetPath, text);
    }

    for (const { targetPath, text } of contributions) {
      this.addOne(sourcePath, targetPath, text);
    }

    if (contributions.length === 0) {
      this.bySource.delete(sourcePath);
    } else {
      this.bySource.set(sourcePath, contributions);
    }

    return getChangedTargetPaths(previous, contributions);
  }

  private addOne(sourcePath: string, targetPath: string, text: string): void {
    let texts = this.byTarget.get(targetPath);

    if (!texts) {
      texts = new Map();
      this.byTarget.set(targetPath, texts);
    }

    let sources = texts.get(text);

    if (!sources) {
      sources = new Map();
      texts.set(text, sources);
    }

    sources.set(sourcePath, (sources.get(sourcePath) ?? 0) + 1);
  }

  private removeOne(sourcePath: string, targetPath: string, text: string): void {
    const texts = this.byTarget.get(targetPath);
    const sources = texts?.get(text);
    const count = sources?.get(sourcePath);

    /* v8 ignore next 3 -- The by-source half only ever holds what was added through `addOne`. */
    if (!texts || !sources || count === undefined) {
      return;
    }

    if (count > 1) {
      sources.set(sourcePath, count - 1);
      return;
    }

    sources.delete(sourcePath);

    if (sources.size === 0) {
      texts.delete(text);
    }

    if (texts.size === 0) {
      this.byTarget.delete(targetPath);
    }
  }
}

// The same order on every machine, whatever its locale.
function compareByCodeUnits(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
}

function getChangedTargetPaths(previous: readonly LinkTextContribution[], next: readonly LinkTextContribution[]): string[] {
  const previousByTarget = groupTexts(previous);
  const nextByTarget = groupTexts(next);
  const changedTargetPaths: string[] = [];

  for (const targetPath of new Set([...previousByTarget.keys(), ...nextByTarget.keys()])) {
    if (previousByTarget.get(targetPath) !== nextByTarget.get(targetPath)) {
      changedTargetPaths.push(targetPath);
    }
  }

  return changedTargetPaths;
}

// One comparable key per target: its texts from this source, sorted, so an unchanged re-read compares equal.
function groupTexts(contributions: readonly LinkTextContribution[]): Map<string, string> {
  const textsByTarget = new Map<string, string[]>();

  for (const { targetPath, text } of contributions) {
    const texts = textsByTarget.get(targetPath) ?? [];
    texts.push(text);
    textsByTarget.set(targetPath, texts);
  }

  return new Map([...textsByTarget].map(([targetPath, texts]) => [targetPath, texts.sort(compareByCodeUnits).join('\u{0}')]));
}

function isAtOrUnder(candidate: string, path: string, isFolderPath: boolean): boolean {
  return isFolderPath ? candidate.startsWith(`${path}/`) : candidate === path;
}
