/**
 * @file
 *
 * The data behind the `External links` module: every note's external links, and for every normalized URL and every
 * host, the notes linking to it.
 *
 * Kept by PATH, which is what an event names, so a note that changes replaces its own contributions wholesale, and by
 * URL and HOST, which is what a query asks, as `TagIndex` is.
 */

import type {
  ExternalHostUsage,
  ExternalLink,
  ExternalUrlUsage,
  HostQueryOptions,
  SimilarHost
} from '../../plugin-api.ts';

import {
  getEditDistance,
  normalizeHost,
  parseExternalUrl
} from './external-links.ts';

/**
 * How far a host may be from the one asked about and still count as similar, when the caller does not say.
 */
export const DEFAULT_MAX_HOST_DISTANCE = 2;

interface UrlEntry {
  readonly host: string;
  readonly paths: Set<string>;
  // As written -> the notes writing it that way.
  readonly writtenForms: Map<string, Set<string>>;
}

/**
 * The per-path, per-URL and per-host maps.
 */
export class ExternalLinkIndex {
  private readonly byPath = new Map<string, readonly ExternalLink[]>();
  private readonly pathsByHost = new Map<string, Set<string>>();
  private readonly urls = new Map<string, UrlEntry>();

  /**
   * Forgets everything.
   */
  public clear(): void {
    this.byPath.clear();
    this.pathsByHost.clear();
    this.urls.clear();
  }

  /**
   * Removes one note's links, for a note that was deleted, moved away or is being parsed again.
   *
   * @param path - The note's path.
   */
  public deletePath(path: string): void {
    this.setPath(path, []);
  }

  /**
   * Lists every host the vault links to.
   *
   * @returns The hosts, most linked-to first by number of notes, then in code-unit order.
   */
  public getHosts(): ExternalHostUsage[] {
    return [...this.pathsByHost].map(([host, paths]) => ({ host, noteCount: paths.size })).sort(compareByNoteCount);
  }

  /**
   * Lists one note's external links.
   *
   * @param path - The note's path.
   * @returns Its links in text order; empty for a note with none, or one not read yet.
   */
  public getLinks(path: string): ExternalLink[] {
    return [...this.byPath.get(path) ?? []];
  }

  /**
   * Finds every note linking to a host.
   *
   * @param host - The host, in any casing, with or without `www.`, a scheme or a path.
   * @param options - Whether a subdomain's links count.
   * @returns The note paths, each once, in code-unit order. Empty for a host no note links to, or no host at all.
   */
  // eslint-disable-next-line typescript-dev-toolkit/params-options-name-match -- The type is the published contract's, so a consumer and this index read one declaration.
  public getPathsLinkingToHost(host: string, options: HostQueryOptions = {}): string[] {
    const normalizedHost = normalizeHost(host);
    if (!normalizedHost) {
      return [];
    }

    if (!options.shouldIncludeSubdomains) {
      return sortPaths(this.pathsByHost.get(normalizedHost) ?? []);
    }

    const suffix = `.${normalizedHost}`;
    const paths = new Set<string>();
    for (const [indexedHost, hostPaths] of this.pathsByHost) {
      if (indexedHost === normalizedHost || indexedHost.endsWith(suffix)) {
        addAll(paths, hostPaths);
      }
    }
    return sortPaths(paths);
  }

  /**
   * Finds every note linking to a URL.
   *
   * @param url - The URL, normalized the index's way, so `https://www.example.com/a/` finds `https://example.com/a`.
   * @returns The note paths, each once, in code-unit order. Empty for a URL no note links to, or no URL at all.
   */
  public getPathsLinkingToUrl(url: string): string[] {
    const parsed = parseExternalUrl(url.trim());
    return parsed ? sortPaths(this.urls.get(parsed.normalizedUrl)?.paths ?? []) : [];
  }

  /**
   * Finds the hosts a few edits away from one, which is what a typo looks like.
   *
   * @param host - The host, normalized the index's way.
   * @param maxDistance - The most edits that still count as similar.
   * @returns The hosts other than this one, nearest first, then most linked-to, then in code-unit order.
   */
  public getSimilarHosts(host: string, maxDistance = DEFAULT_MAX_HOST_DISTANCE): SimilarHost[] {
    const normalizedHost = normalizeHost(host);
    if (!normalizedHost) {
      return [];
    }

    const similarHosts: SimilarHost[] = [];
    for (const [indexedHost, paths] of this.pathsByHost) {
      if (indexedHost === normalizedHost) {
        continue;
      }
      const distance = getEditDistance(normalizedHost, indexedHost, maxDistance);
      if (distance <= maxDistance) {
        similarHosts.push({ distance, host: indexedHost, noteCount: paths.size });
      }
    }

    return similarHosts.sort((a, b) => a.distance - b.distance || compareByNoteCount(a, b));
  }

  /**
   * Lists every URL the vault links to, or those on one host.
   *
   * @param host - The host to list, exactly; omitted, every host.
   * @returns The URLs, most linked-to first by number of notes, then in code-unit order of the normalized URL.
   */
  public getUrls(host?: string): ExternalUrlUsage[] {
    const normalizedHost = host === undefined ? null : normalizeHost(host);
    if (host !== undefined && !normalizedHost) {
      return [];
    }

    const usages: ExternalUrlUsage[] = [];
    for (const [normalizedUrl, entry] of this.urls) {
      if (normalizedHost === null || entry.host === normalizedHost) {
        usages.push({ host: entry.host, normalizedUrl, noteCount: entry.paths.size, url: getMostWrittenForm(entry) });
      }
    }

    return usages.sort((a, b) => b.noteCount - a.noteCount || compareByCodeUnits(a.normalizedUrl, b.normalizedUrl));
  }

  /**
   * Replaces one note's links.
   *
   * @param path - The note's path.
   * @param links - Everything it now links to.
   */
  public setPath(path: string, links: readonly ExternalLink[]): void {
    for (const link of this.byPath.get(path) ?? []) {
      this.remove(path, link);
    }

    for (const link of links) {
      this.add(path, link);
    }

    if (links.length === 0) {
      this.byPath.delete(path);
    } else {
      this.byPath.set(path, links);
    }
  }

  private add(path: string, link: ExternalLink): void {
    getOrCreate(this.pathsByHost, link.host, () => new Set<string>()).add(path);
    const entry = getOrCreate(this.urls, link.normalizedUrl, () => ({ host: link.host, paths: new Set<string>(), writtenForms: new Map<string, Set<string>>() }));
    entry.paths.add(path);
    getOrCreate(entry.writtenForms, link.url, () => new Set<string>()).add(path);
  }

  private remove(path: string, link: ExternalLink): void {
    deleteFromSet(this.pathsByHost, link.host, path);

    const entry = this.urls.get(link.normalizedUrl);
    /* v8 ignore next 3 -- Every link removed here was added by `add`, which made its entry. */
    if (!entry) {
      return;
    }

    deleteFromSet(entry.writtenForms, link.url, path);
    // A note linking to the URL in two written forms keeps linking to it until both are gone.
    if ([...entry.writtenForms.values()].every((paths) => !paths.has(path))) {
      entry.paths.delete(path);
    }
    if (entry.paths.size === 0) {
      this.urls.delete(link.normalizedUrl);
    }
  }
}

function addAll(set: Set<string>, values: Iterable<string>): void {
  for (const value of values) {
    set.add(value);
  }
}

// The same order on every machine, whatever its locale. Only ever compares distinct members of one set.
function compareByCodeUnits(a: string, b: string): number {
  return a < b ? -1 : 1;
}

function compareByNoteCount(a: ExternalHostUsage, b: ExternalHostUsage): number {
  return b.noteCount - a.noteCount || compareByCodeUnits(a.host, b.host);
}

function deleteFromSet(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key);
  set?.delete(value);
  if (set?.size === 0) {
    map.delete(key);
  }
}

function getMostWrittenForm(entry: UrlEntry): string {
  let best = '';
  let bestCount = 0;
  for (const [writtenForm, paths] of entry.writtenForms) {
    if (!(paths.size > bestCount || (paths.size === bestCount && writtenForm < best))) {
      continue;
    }

    best = writtenForm;
    bestCount = paths.size;
  }
  return best;
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = create();
    map.set(key, value);
  }
  return value;
}

function sortPaths(paths: Iterable<string>): string[] {
  return [...paths].sort(compareByCodeUnits);
}
