/**
 * @file
 *
 * The per-file forward read behind the `Titles` module: what a note's configured name-bearing
 * frontmatter properties say it is called.
 *
 * It is the mirror of `../names/name-index.ts`, and deliberately the opposite shape in both axes:
 *
 * - **Forward**, `file -> titles`, not `name -> paths`. The reverse direction is the name index's, and
 *   it consumes this one; a caller holding its own forward index of the vault wants this one.
 * - **Lazy**, memoized on first use per path, not built eagerly. A forward answer HAS a "first use for
 *   this path" to memoize on, which is precisely what a reverse lookup lacks — and laziness sidesteps
 *   the metadata cache being unpopulated when a plugin loads, since a title read before the cache can
 *   answer would simply be wrong and no later event would say so for a file already parsed.
 *
 * Nothing here normalizes a title. The values come back exactly as they were typed, because a consumer
 * that renders them needs the user's own casing and spacing; the name index normalizes on its own way
 * in, the same way it does for a basename and an alias.
 */

import type {
  App,
  FrontMatterCache,
  TFile
} from 'obsidian';
import type { ReadonlyPluginSettings } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';

import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';
import type { PluginSettings } from '../../plugin-settings.ts';

interface TitleIndexConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Answers what a note's own frontmatter says it is called.
 */
export class TitleIndex {
  private readonly app: App;
  private memoizedPropertyNamesKey: null | string = null;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly titles = new Map<string, readonly string[]>();

  public constructor(params: TitleIndexConstructorParams) {
    this.app = params.app;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  /**
   * Forgets every memoized answer.
   *
   * The module's component calls it at both of its edges, because nothing invalidates this index while
   * the module is off: a note whose `title` changed during that time has no event left to replay.
   */
  public clear(): void {
    this.titles.clear();
    this.memoizedPropertyNamesKey = null;
  }

  /**
   * The frontmatter properties whose values currently count as titles.
   *
   * **Empty while the module is off**, which is the same answer as "none are configured" and is meant
   * to be: either way there is nothing for a caller to read. A caller that needs to tell the two apart
   * is asking about this plugin's settings rather than about the vault.
   *
   * @returns The configured property names, in the order they were typed.
   */
  public getTitlePropertyNames(): string[] {
    const settings = this.pluginSettingsComponent.settings;

    if (!settings.isTitlesModuleEnabled) {
      return [];
    }

    return normalizePropertyNames(settings);
  }

  /**
   * Reads one note's titles.
   *
   * @param file - The file to read.
   * @returns Its titles, in the order the configured properties were typed, with repeats of a title
   *   already in the list dropped case-insensitively. Empty while the module is off.
   */
  public getTitles(file: TFile): readonly string[] {
    const propertyNames = this.getTitlePropertyNames();

    if (propertyNames.length === 0) {
      return [];
    }

    const propertyNamesKey = propertyNames.join('\n');

    // The memo is keyed by the whole property list, so editing the list can never be read through a
    // memo taken under the old one. The component clears at its own edges too; this is what makes the
    // two independent rather than ordered.
    if (this.memoizedPropertyNamesKey !== propertyNamesKey) {
      this.titles.clear();
      this.memoizedPropertyNamesKey = propertyNamesKey;
    }

    const memoized = this.titles.get(file.path);

    if (memoized) {
      return memoized;
    }

    const titles = readTitles(this.app.metadataCache.getFileCache(file)?.frontmatter, propertyNames);
    this.titles.set(file.path, titles);
    return titles;
  }

  /**
   * Forgets what is known about one path.
   *
   * @param path - The vault-relative path that changed, was created, or was deleted.
   */
  public invalidate(path: string): void {
    this.titles.delete(path);
  }

  /**
   * Forgets a whole folder's worth of paths, for when a folder is renamed or deleted.
   *
   * @param folderPath - The vault-relative path of the folder.
   */
  public invalidateSubtree(folderPath: string): void {
    const prefix = `${folderPath}/`;

    for (const path of this.titles.keys()) {
      if (path.startsWith(prefix)) {
        this.titles.delete(path);
      }
    }
  }
}

/**
 * Reads the titles out of one note's frontmatter.
 *
 * Exported, and taking the frontmatter rather than the file, because the name index calls it with the
 * frontmatter it has already read — which is what keeps that index off this one's MEMO. Both listen to
 * `changed`, in whichever order the modules happened to be switched on, so a name index reading through
 * the memo could be handed the title of a file the memo had not yet dropped. There is no ordering to get
 * right if there is nothing to invalidate.
 *
 * @param frontmatter - The note's frontmatter, or nothing when it has none.
 * @param propertyNames - The properties whose values count as titles.
 * @returns The titles, trimmed, in the order the properties were given, with repeats dropped
 *   case-insensitively.
 */
export function readTitles(frontmatter: FrontMatterCache | undefined, propertyNames: readonly string[]): string[] {
  if (!frontmatter || propertyNames.length === 0) {
    return [];
  }

  const titles: string[] = [];
  const seen = new Set<string>();

  for (const propertyName of propertyNames) {
    const rawValue: unknown = frontmatter[propertyName];

    for (const rawTitle of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      const title = toTitle(rawTitle);

      if (!title || seen.has(title.toLowerCase())) {
        continue;
      }

      seen.add(title.toLowerCase());
      titles.push(title);
    }
  }

  return titles;
}

/**
 * Reads the configured property names, dropping the blanks a free-text list inevitably collects.
 *
 * @param settings - The current effective settings.
 * @returns The property names worth asking about.
 */
function normalizePropertyNames(settings: ReadonlyPluginSettings<PluginSettings>): string[] {
  const propertyNames: string[] = [];
  const seen = new Set<string>();

  for (const rawPropertyName of settings.titlePropertyNames) {
    const propertyName = rawPropertyName.trim();

    if (!propertyName || seen.has(propertyName)) {
      continue;
    }

    seen.add(propertyName);
    propertyNames.push(propertyName);
  }

  return propertyNames;
}

/**
 * Turns one raw frontmatter value into a title, or into nothing.
 *
 * A `number` is accepted alongside a `string` because an unquoted `title: 2026` parses as one, and a
 * user who typed it plainly meant the text. Everything else — a boolean, a nested mapping, `null` — is
 * not a name anybody typed, and guessing at one would put it in the name index under a name no
 * wikilink can say.
 *
 * @param rawTitle - The raw value read out of the frontmatter.
 * @returns The title, trimmed, or an empty string when the value is not one.
 */
function toTitle(rawTitle: unknown): string {
  if (typeof rawTitle === 'string') {
    return rawTitle.trim();
  }

  if (typeof rawTitle === 'number' && Number.isFinite(rawTitle)) {
    return rawTitle.toString();
  }

  return '';
}
