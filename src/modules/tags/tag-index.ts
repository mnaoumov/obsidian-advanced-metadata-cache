/**
 * @file
 *
 * The data behind the `Tags` module: for every tag, the notes carrying it, kept apart by where the note wrote it.
 * `metadataCache.getTags()` counts tags and names no note, so without this "which notes carry `#project`" reads
 * every note's cache.
 *
 * A note writes a tag in two places that Obsidian keeps apart too: in the body (`#project`, which is
 * `CachedMetadata.tags`) and in the `tags` property (`tags: [project]`, which is `frontmatter.tags`). `getAllTags`
 * merges the two, and a consumer that needs to know which one it was cannot get that back, so both are indexed and a
 * query names the one it wants or neither.
 *
 * Kept twice on purpose, as `LinkTextIndex` is: by TAG, which is what a query asks, and by PATH, which is what an
 * event names, so a note that changes replaces its own contributions wholesale.
 */

import type { CachedMetadata } from 'obsidian';

import { parseFrontMatterTags } from 'obsidian';

import type { TagQueryOptions } from '../../plugin-api.ts';

/**
 * One note's tags, normalized by {@link normalizeTag}, by where it wrote them.
 */
export interface TagContribution {
  readonly bodyTags: ReadonlySet<string>;
  readonly frontmatterTags: ReadonlySet<string>;
}

/**
 * Where a note wrote a tag: in its body, or in its `tags` property.
 */
export type TagSource = NonNullable<TagQueryOptions['source']>;

const TAG_SOURCES: readonly TagSource[] = ['body', 'frontmatter'];

/**
 * The per-tag and per-path maps.
 */
export class TagIndex {
  private readonly byPath = new Map<string, TagContribution>();
  // Source -> normalized tag -> paths of the notes carrying it there.
  private readonly byTag: Readonly<Record<TagSource, Map<string, Set<string>>>> = {
    body: new Map(),
    frontmatter: new Map()
  };

  /**
   * Forgets everything.
   */
  public clear(): void {
    this.byPath.clear();
    for (const source of TAG_SOURCES) {
      this.byTag[source].clear();
    }
  }

  /**
   * Removes one note's tags, for a note that was deleted or moved away.
   *
   * @param path - The note's path.
   */
  public deletePath(path: string): void {
    this.setPath(path, { bodyTags: new Set(), frontmatterTags: new Set() });
  }

  /**
   * Lists the indexed notes at a path or, for a folder, under it.
   *
   * @param path - A file or folder path.
   * @param isFolderPath - Whether the path is a folder's.
   * @returns The note paths.
   */
  public getPaths(path: string, isFolderPath: boolean): string[] {
    return [...this.byPath.keys()].filter((candidate) => isFolderPath ? candidate.startsWith(`${path}/`) : candidate === path);
  }

  /**
   * Finds every note carrying a tag.
   *
   * @param tag - The tag, with or without its `#`, in any casing.
   * @param options - Which source counts, and whether nested tags answer for their parent.
   * @returns The note paths, each once, in code-unit order. Empty for a tag no note carries, and for an empty tag.
   */
  // eslint-disable-next-line typescript-dev-toolkit/params-options-name-match -- The type is the published contract's, so a consumer and this index read one declaration.
  public getPathsWithTag(tag: string, options: TagQueryOptions = {}): string[] {
    const normalizedTag = normalizeTag(tag);

    if (!normalizedTag) {
      return [];
    }

    const shouldIncludeNestedTags = options.shouldIncludeNestedTags ?? true;
    const nestedPrefix = `${normalizedTag}/`;
    const paths = new Set<string>();

    for (const source of options.source ? [options.source] : TAG_SOURCES) {
      const pathsByTag = this.byTag[source];

      if (!shouldIncludeNestedTags) {
        addAll(paths, pathsByTag.get(normalizedTag) ?? []);
        continue;
      }

      // Every distinct tag once per query: a vault holds thousands of tags at most, and a prefix map kept in step
      // would cost every change more than this costs a query.
      for (const [indexedTag, tagPaths] of pathsByTag) {
        if (indexedTag === normalizedTag || indexedTag.startsWith(nestedPrefix)) {
          addAll(paths, tagPaths);
        }
      }
    }

    return [...paths].sort(compareByCodeUnits);
  }

  /**
   * Carries one note's tags to the path it was renamed to.
   *
   * @param oldPath - The path it had.
   * @param newPath - The path it has now.
   */
  public movePath(oldPath: string, newPath: string): void {
    const contribution = this.byPath.get(oldPath);

    /* v8 ignore next 3 -- The component moves only the paths it has just listed. */
    if (!contribution) {
      return;
    }

    this.deletePath(oldPath);
    this.setPath(newPath, contribution);
  }

  /**
   * Replaces one note's tags.
   *
   * @param path - The note's path.
   * @param contribution - Everything it now carries.
   */
  public setPath(path: string, contribution: TagContribution): void {
    const previous = this.byPath.get(path);

    if (previous) {
      this.removeAll('body', path, previous.bodyTags);
      this.removeAll('frontmatter', path, previous.frontmatterTags);
    }

    this.addAll('body', path, contribution.bodyTags);
    this.addAll('frontmatter', path, contribution.frontmatterTags);

    if (contribution.bodyTags.size === 0 && contribution.frontmatterTags.size === 0) {
      this.byPath.delete(path);
    } else {
      this.byPath.set(path, contribution);
    }
  }

  private addAll(source: TagSource, path: string, tags: ReadonlySet<string>): void {
    const pathsByTag = this.byTag[source];

    for (const tag of tags) {
      let paths = pathsByTag.get(tag);

      if (!paths) {
        paths = new Set();
        pathsByTag.set(tag, paths);
      }

      paths.add(path);
    }
  }

  private removeAll(source: TagSource, path: string, tags: ReadonlySet<string>): void {
    const pathsByTag = this.byTag[source];

    for (const tag of tags) {
      const paths = pathsByTag.get(tag);
      paths?.delete(path);

      if (paths?.size === 0) {
        pathsByTag.delete(tag);
      }
    }
  }
}

/**
 * Brings a tag to the one form the index keys on: no leading `#`, lower case, since Obsidian treats `#Project` and
 * `#project` as one tag.
 *
 * @param tag - The tag as written or asked for.
 * @returns The normalized tag; empty for `#` alone.
 */
export function normalizeTag(tag: string): string {
  return (tag.startsWith('#') ? tag.slice(1) : tag).toLowerCase();
}

/**
 * Reads one note's tags out of its cache entry.
 *
 * The frontmatter half goes through Obsidian's own `parseFrontMatterTags`, so a property Obsidian would not count as
 * a tag (an entry holding a space, a non-string list member) is not counted here either, and the merged answer is the
 * one `getAllTags` gives.
 *
 * @param cache - The note's cache entry.
 * @returns Its tags, by source.
 */
export function readTags(cache: CachedMetadata): TagContribution {
  const bodyTags = new Set<string>();
  for (const tagCache of cache.tags ?? []) {
    addNormalized(bodyTags, tagCache.tag);
  }

  const frontmatterTags = new Set<string>();
  for (const tag of parseFrontMatterTags(cache.frontmatter ?? null) ?? []) {
    addNormalized(frontmatterTags, tag);
  }

  return { bodyTags, frontmatterTags };
}

function addAll(set: Set<string>, values: Iterable<string>): void {
  for (const value of values) {
    set.add(value);
  }
}

function addNormalized(tags: Set<string>, tag: string): void {
  const normalizedTag = normalizeTag(tag);

  if (normalizedTag) {
    tags.add(normalizedTag);
  }
}

// The same order on every machine, whatever its locale. Only ever sorts a set's members, so no two are equal.
function compareByCodeUnits(a: string, b: string): number {
  return a < b ? -1 : 1;
}
