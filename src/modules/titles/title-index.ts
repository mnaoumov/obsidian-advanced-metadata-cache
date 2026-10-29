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
 *
 * A title comes from one of two SOURCES. A title property's value is a title as it stands. A name
 * pattern is a list of properties (`[lastName, firstName]`) whose values are joined into a name that
 * nobody wrote down: a person note keeps only its name parts, and every other order and form is built
 * here. A part may hold several forms keyed by language (`{Наумов: [ru, uk], Naumov: [en]}`), and a
 * pattern then runs once per language with no fallback between them, so no name mixing two languages
 * is ever built.
 */

import type { ReadonlyPluginSettings } from '@mnaoumov/obsidian-lib/components/plugin-settings-component';
import type {
  App,
  FrontMatterCache,
  TFile
} from 'obsidian';

import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';
import type { PluginSettings } from '../../plugin-settings.ts';

/**
 * Where a note's titles are read from.
 */
export interface TitleSources {
  /**
   * The name patterns, each a list of the properties whose values are joined into one name.
   */
  readonly namePatterns: readonly (readonly string[])[];

  /**
   * The properties whose values are titles as they stand.
   */
  readonly propertyNames: readonly string[];
}

interface NamePart {
  readonly languageForms: ReadonlyMap<string, readonly string[]>;
  readonly plainForms: readonly string[];
}

interface TitleIndexConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Answers what a note's own frontmatter says it is called.
 */
export class TitleIndex {
  private readonly app: App;
  private memoizedSourcesKey: null | string = null;
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
    this.memoizedSourcesKey = null;
  }

  /**
   * The name patterns whose built names currently count as titles.
   *
   * Empty while the module is off, for the same reason as {@link TitleIndex.getTitlePropertyNames}.
   *
   * @returns The configured patterns, in the order they were typed.
   */
  public getTitleNamePatterns(): string[][] {
    const settings = this.pluginSettingsComponent.settings;

    return settings.isTitlesModuleEnabled ? normalizeNamePatterns(settings.titleNamePatterns) : [];
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

    return settings.isTitlesModuleEnabled ? normalizePropertyNames(settings) : [];
  }

  /**
   * Reads one note's titles.
   *
   * @param file - The file to read.
   * @returns Its titles: the title properties' values in the order the properties were typed, then the
   *   names the patterns build, with repeats of a title already in the list dropped case-insensitively.
   *   Empty while the module is off.
   */
  public getTitles(file: TFile): readonly string[] {
    const sources = this.getTitleSources();

    if (sources.propertyNames.length === 0 && sources.namePatterns.length === 0) {
      return [];
    }

    const sourcesKey = getTitleSourcesKey(sources);

    // The memo is keyed by both whole lists, so editing either can never be read through a memo taken
    // under the old one. The component clears at its own edges too; this is what makes the two
    // independent rather than ordered.
    if (this.memoizedSourcesKey !== sourcesKey) {
      this.titles.clear();
      this.memoizedSourcesKey = sourcesKey;
    }

    const memoized = this.titles.get(file.path);

    if (memoized) {
      return memoized;
    }

    const titles = readTitles(this.app.metadataCache.getFileCache(file)?.frontmatter, sources);
    this.titles.set(file.path, titles);
    return titles;
  }

  /**
   * Both sources at once, which is what every reader of titles is handed.
   *
   * @returns The configured title properties and name patterns; both empty while the module is off.
   */
  public getTitleSources(): TitleSources {
    return {
      namePatterns: this.getTitleNamePatterns(),
      propertyNames: this.getTitlePropertyNames()
    };
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
 * Builds the names one pattern gives one note.
 *
 * The pattern runs once per language that any of its parts lists, in the order the languages first
 * appear; a part contributes its plain forms to every run and its language forms to that language's run
 * only. A part with nothing for a run is SKIPPED in it rather than borrowed from another language, so
 * `{Бондар: [uk]}` and `{Bondar: [en]}` never meet in one name. With no language anywhere there is one
 * run, of the plain forms. Several forms of a part multiply.
 *
 * @param frontmatter - The note's frontmatter.
 * @param namePattern - The properties to join, in order.
 * @returns The built names, joined with single spaces, possibly with repeats; {@link readTitles} drops them.
 */
export function buildNames(frontmatter: FrontMatterCache, namePattern: readonly string[]): string[] {
  const parts = namePattern.map((propertyName) => readNamePart(frontmatter[propertyName]));
  const languages = new Set<string>();

  for (const part of parts) {
    for (const language of part.languageForms.keys()) {
      languages.add(language);
    }
  }

  const runs: (null | string)[] = languages.size === 0 ? [null] : [...languages];
  const names: string[] = [];

  for (const language of runs) {
    const formsPerPart = parts
      .map((part) => [...part.plainForms, ...(language === null ? [] : part.languageForms.get(language) ?? [])])
      .filter((forms) => forms.length > 0);

    if (formsPerPart.length === 0) {
      continue;
    }

    let combinations = [''];

    for (const forms of formsPerPart) {
      combinations = combinations.flatMap((prefix) => forms.map((form) => prefix ? `${prefix} ${form}` : form));
    }

    names.push(...combinations);
  }

  return names;
}

/**
 * The key a memo of titles is valid under: two sources with the same key read every note the same way.
 *
 * @param sources - The sources.
 * @returns The key.
 */
export function getTitleSourcesKey(sources: TitleSources): string {
  return JSON.stringify(sources);
}

/**
 * Reads the name patterns the way the settings tab states them: one pattern per line, its properties
 * separated by commas.
 *
 * @param lines - The raw lines.
 * @returns The patterns, each property trimmed, blank properties and empty patterns dropped.
 */
export function parseNamePatterns(lines: readonly string[]): string[][] {
  return normalizeNamePatterns(lines.map((line) => line.split(',')));
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
 * @param sources - The properties whose values count as titles, and the name patterns.
 * @returns The titles, trimmed: the title properties' values in the order the properties were given, then
 *   each pattern's names in the order the patterns were given, with repeats dropped case-insensitively.
 */
export function readTitles(frontmatter: FrontMatterCache | undefined, sources: TitleSources): string[] {
  if (!frontmatter) {
    return [];
  }

  const titles: string[] = [];
  const seen = new Set<string>();

  function add(title: string): void {
    if (!title || seen.has(title.toLowerCase())) {
      return;
    }

    seen.add(title.toLowerCase());
    titles.push(title);
  }

  for (const propertyName of sources.propertyNames) {
    const rawValue: unknown = frontmatter[propertyName];

    for (const rawTitle of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      add(toTitle(rawTitle));
    }
  }

  for (const namePattern of sources.namePatterns) {
    for (const name of buildNames(frontmatter, namePattern)) {
      add(name);
    }
  }

  return titles;
}

/**
 * Drops the blanks and repeats a free-text list of patterns inevitably collects.
 *
 * @param rawNamePatterns - The patterns as stored.
 * @returns The patterns worth running, in their order.
 */
function normalizeNamePatterns(rawNamePatterns: readonly (readonly string[])[]): string[][] {
  const namePatterns: string[][] = [];
  const seen = new Set<string>();

  for (const rawNamePattern of rawNamePatterns) {
    const namePattern = rawNamePattern.map((propertyName) => propertyName.trim()).filter((propertyName) => propertyName !== '');
    const key = JSON.stringify(namePattern);

    if (namePattern.length === 0 || seen.has(key)) {
      continue;
    }

    seen.add(key);
    namePatterns.push(namePattern);
  }

  return namePatterns;
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
 * Reads one name part's value.
 *
 * A string or a number is one plain form, and a list is several; either belongs to every language. A
 * mapping is keyed by the FORM and valued by its languages, a list of them or a single one, so a form
 * shared by several languages is written once: `{Наумов: [ru, uk], Naumov: [en]}`. Anything else
 * contributes nothing.
 *
 * @param rawValue - The raw frontmatter value.
 * @returns The part's plain forms and its forms per language.
 */
function readNamePart(rawValue: unknown): NamePart {
  const plainForms: string[] = [];
  const languageForms = new Map<string, string[]>();

  if (Array.isArray(rawValue) || typeof rawValue !== 'object' || rawValue === null) {
    for (const rawForm of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      const form = toTitle(rawForm);

      if (form) {
        plainForms.push(form);
      }
    }

    return { languageForms, plainForms };
  }

  for (const [rawForm, rawLanguages] of Object.entries(rawValue)) {
    const form = rawForm.trim();

    if (!form) {
      continue;
    }

    for (const rawLanguage of Array.isArray(rawLanguages) ? rawLanguages : [rawLanguages]) {
      if (typeof rawLanguage !== 'string' || !rawLanguage.trim()) {
        continue;
      }

      const language = rawLanguage.trim();
      let forms = languageForms.get(language);

      if (!forms) {
        forms = [];
        languageForms.set(language, forms);
      }

      forms.push(form);
    }
  }

  return { languageForms, plainForms };
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

  return typeof rawTitle === 'number' && Number.isFinite(rawTitle) ? rawTitle.toString() : '';
}
