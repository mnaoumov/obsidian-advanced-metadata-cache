/**
 * @file
 *
 * The `name -> paths` reverse index, and the memoized `LinkSuggestion[]` that answers
 * `metadataCache.getLinkSuggestions()`.
 *
 * Obsidian's own `getLinkSuggestions` walks `vault.getFiles()` in full on EVERY call, asking
 * `getFileCache` and parsing frontmatter aliases per file, and the `[[` autocomplete discards its
 * memo of that array when the popover closes — so the whole walk is re-run on every open. Measured
 * on this plugin's performance vault (Obsidian 1.14.2, notes with no frontmatter at all, so a floor
 * rather than a typical cost):
 *
 * | files  | per call  | per 1000 files |
 * |--------|-----------|----------------|
 * | 20 152 | 22.8 ms   | 1.13 ms        |
 * | 90 152 | 108.4 ms  | 1.20 ms        |
 *
 * `get-link-suggestions-baseline.desktop-performance.integration.test.ts` is that measurement, and
 * it also counts the calls the real suggester makes: one per `[[` open, never amortized.
 *
 * What is memoized here is the EXPENSIVE half — per file, its display path, its alias entries and
 * its names — keyed by path and dropped when that path changes. The cheap half, the walk itself, is
 * redone on each rebuild, deliberately: it costs a map lookup per file and it is what keeps the
 * answer in `vault.getFiles()` order, which is the order Obsidian's own array is in.
 */

import type { LinkSuggestion } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  TFile
} from 'obsidian';

import { parseFrontMatterAliases } from 'obsidian';
import { trimMarkdownExtension } from 'obsidian-dev-utils/obsidian/file-system';

import type { TitleIndex } from '../titles/title-index.ts';

import { readTitles } from '../titles/title-index.ts';

/**
 * The length Obsidian truncates an unresolved link's text to before offering it as a suggestion.
 * Mirrored so the patched answer carries the same entries as the original.
 */
const MAX_UNRESOLVED_LINK_TEXT_LENGTH = 500;

/**
 * What one indexed file contributes: the suggestion entries Obsidian would push for it, and the
 * normalized names it answers to.
 *
 * The names are kept beside the entries rather than derived from them because they are the undo log:
 * removing a path means removing exactly these names from the reverse map, and by then the file's
 * frontmatter has already changed.
 */
interface IndexedFile {
  readonly entries: readonly LinkSuggestion[];
  readonly names: readonly string[];
}

interface NameIndexConstructorParams {
  readonly app: App;
  readonly titleIndex: TitleIndex;
}

/**
 * Answers what notes are called, and what the `[[` autocomplete should offer.
 */
export class NameIndex {
  private readonly app: App;
  private readonly indexedFiles = new Map<string, IndexedFile>();
  private memoizedSuggestions: LinkSuggestion[] | null = null;
  private readonly namePaths = new Map<string, Set<string>>();
  private readonly titleIndex: TitleIndex;

  public constructor(params: NameIndexConstructorParams) {
    this.app = params.app;
    this.titleIndex = params.titleIndex;
  }

  /**
   * Indexes every file in the vault.
   *
   * Eager rather than lazy, which is the one way this differs from a memoizing index: a reverse
   * lookup has no "first use for this path" to memoize on — `getPathsByName` is asked about a name
   * and cannot know which paths might answer to it, so every path has to be in the map before the
   * first question.
   */
  public buildAll(): void {
    this.clear();

    // Read once for the whole walk rather than per file: it is the same answer for every one of
    // them, and this loop runs across the entire vault.
    const titlePropertyNames = this.titleIndex.getTitlePropertyNames();

    for (const file of this.app.vault.getFiles()) {
      this.index(file, titlePropertyNames);
    }
  }

  /**
   * Forgets everything.
   */
  public clear(): void {
    this.indexedFiles.clear();
    this.namePaths.clear();
    this.memoizedSuggestions = null;
  }

  /**
   * Finds every note that answers to a name.
   *
   * The answer is a LIST because several notes may declare the same alias, and it is deliberately
   * UNRANKED and complete: which of two notes called `Meeting` the user meant is a question about
   * the caller's context — the note being edited, what it already links to — and nothing here knows
   * that. Ranking is the caller's job.
   *
   * @param name - A basename or alias, in any casing and spacing.
   * @returns The vault-relative paths of the notes carrying that name, in vault order. Empty when
   *   nothing carries it.
   */
  public getPathsByName(name: string): string[] {
    return [...this.namePaths.get(normalizeName(name)) ?? []];
  }

  /**
   * Builds the array `metadataCache.getLinkSuggestions()` answers with.
   *
   * @returns A fresh array, so a caller that sorts or splices it — as Obsidian's own suggester does
   *   with its derived results — cannot disturb the memo behind it.
   */
  public getSuggestions(): LinkSuggestion[] {
    this.memoizedSuggestions ??= this.buildSuggestions();
    return [...this.memoizedSuggestions];
  }

  /**
   * Drops the memoized suggestion array without touching what is known about any file.
   *
   * Used for the half of the answer this index does not own: the unresolved-link entries come
   * straight out of `metadataCache.unresolvedLinks`, which changes under a `resolve` of a file whose
   * own metadata this index has already accounted for.
   */
  public invalidateSuggestions(): void {
    this.memoizedSuggestions = null;
  }

  /**
   * Re-reads one file: its display path, its aliases and its names.
   *
   * @param file - The file to re-index.
   */
  public refresh(file: TFile): void {
    this.remove(file.path);
    this.index(file, this.titleIndex.getTitlePropertyNames());
  }

  /**
   * Forgets one path, removing its names from the reverse map.
   *
   * @param path - The vault-relative path.
   */
  public remove(path: string): void {
    const indexedFile = this.indexedFiles.get(path);

    if (!indexedFile) {
      return;
    }

    for (const name of indexedFile.names) {
      const paths = this.namePaths.get(name);

      /* v8 ignore next 3 -- `index` puts every name it records into `namePaths`, so a name in the undo log always has a set behind it. */
      if (!paths) {
        continue;
      }

      paths.delete(path);

      if (paths.size === 0) {
        this.namePaths.delete(name);
      }
    }

    this.indexedFiles.delete(path);
    this.memoizedSuggestions = null;
  }

  /**
   * Forgets a whole folder's worth of paths.
   *
   * A folder rename moves every descendant's path without changing a single name, and Obsidian's
   * event order for the folder against its descendants is not a contract — the descendants may fire
   * their own `rename` events, or they may not. So the rename handler drops both sides of the move
   * and re-indexes the folder's files from the live vault, which reaches the same state whether it
   * runs once, twice, or after the per-file events have already done the work.
   *
   * @param folderPath - The vault-relative path of the folder.
   */
  public removeSubtree(folderPath: string): void {
    const prefix = `${folderPath}/`;

    // Deleting the key the iterator is standing on is defined behavior for a `Map`, so the walk
    // needs no copy of the keys to delete from underneath itself.
    for (const path of this.indexedFiles.keys()) {
      if (path.startsWith(prefix)) {
        this.remove(path);
      }
    }
  }

  private buildSuggestions(): LinkSuggestion[] {
    const suggestions: LinkSuggestion[] = [];
    const seenPaths = new Set<string>();
    const titlePropertyNames = this.titleIndex.getTitlePropertyNames();

    /*
     * Walked in `vault.getFiles()` order rather than in this index's own insertion order, so the
     * array matches the one Obsidian builds entry for entry. A file the events have not reached yet
     * is indexed here, which makes the walk self-healing as well as ordered.
     */
    for (const file of this.app.vault.getFiles()) {
      const indexedFile = this.indexedFiles.get(file.path) ?? this.index(file, titlePropertyNames);

      for (const entry of indexedFile.entries) {
        suggestions.push(entry);

        if (entry.alias === undefined) {
          seenPaths.add(entry.path);
        }
      }
    }

    for (const links of Object.values(this.app.metadataCache.unresolvedLinks)) {
      for (const linkText of Object.keys(links)) {
        const truncatedLinkText = linkText.slice(0, MAX_UNRESOLVED_LINK_TEXT_LENGTH);

        if (seenPaths.has(truncatedLinkText)) {
          continue;
        }

        seenPaths.add(truncatedLinkText);
        suggestions.push({ file: null, path: truncatedLinkText });
      }
    }

    return suggestions;
  }

  private index(file: TFile, titlePropertyNames: readonly string[]): IndexedFile {
    if (!this.app.metadataCache.isSupportedFile(file)) {
      const unsupportedFile: IndexedFile = { entries: [], names: [] };
      this.indexedFiles.set(file.path, unsupportedFile);
      return unsupportedFile;
    }

    const displayPath = trimMarkdownExtension(file);
    const entries: LinkSuggestion[] = [{ file, path: displayPath }];
    const names = new Set<string>([normalizeName(basename(displayPath))]);
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;

    for (const alias of parseFrontMatterAliases(frontmatter) ?? []) {
      entries.push({ alias, file, path: displayPath });
      names.add(normalizeName(alias));
    }

    /*
     * A title becomes a NAME and deliberately NOT an entry.
     *
     * `getSuggestions()` is a replacement for `metadataCache.getLinkSuggestions()`, and its contract is
     * that it answers the array Obsidian would, only cheaper — the README says so, the demo vault says
     * so, and the on/off tripwire suite measures the two against each other. Pushing a title in here
     * would make the `[[` autocomplete offer something Obsidian does not, which is a user-visible
     * feature with its own design questions rather than a faster answer to the same question.
     *
     * The reverse map is the other half, and is this plugin's own: `getPathsByName` answers a question
     * the built-in flat array cannot answer at all, so widening it costs no parity.
     *
     * Read from the frontmatter already in hand rather than through the title index's memo — see
     * `readTitles` for why that is not an optimization but the thing that makes the two modules
     * independent of the order they were switched on in.
     */
    for (const title of readTitles(frontmatter, titlePropertyNames)) {
      names.add(normalizeName(title));
    }

    const indexedFile: IndexedFile = { entries, names: [...names] };
    this.indexedFiles.set(file.path, indexedFile);

    for (const name of indexedFile.names) {
      let paths = this.namePaths.get(name);

      if (!paths) {
        paths = new Set<string>();
        this.namePaths.set(name, paths);
      }

      paths.add(file.path);
    }

    this.memoizedSuggestions = null;
    return indexedFile;
  }
}

/**
 * Normalizes a name for lookup: lowercased, with runs of whitespace collapsed.
 *
 * Obsidian treats `[[some  alias]]` and `[[Some Alias]]` as naming the same note, so comparisons
 * happen in this space. Adopted verbatim from `obsidian-better-markdown-links`, which resolves
 * wikilinks by alias the same way — two different answers to "is this the same name?" would be
 * worse than either.
 *
 * @param name - The raw basename or alias.
 * @returns The name in normalized space.
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().replaceAll(/ {2,}/g, ' ');
}

/**
 * Takes the last segment of a path.
 *
 * Applied to the DISPLAY path, so a note's name is what a `[[wikilink]]` can say: `foo` for
 * `Notes/foo.md`, `image.png` for `Attachments/image.png`.
 *
 * @param path - The display path.
 * @returns Its last segment.
 */
function basename(path: string): string {
  const slashIndex = path.lastIndexOf('/');
  return slashIndex === -1 ? path : path.slice(slashIndex + 1);
}
