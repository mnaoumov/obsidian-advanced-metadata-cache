/**
 * @file
 *
 * The state behind the `Properties` module: for each frontmatter property a consumer registered, which
 * notes carry it and with which values.
 *
 * Only registered properties are indexed, so a vault nobody asks about costs nothing; the module's component
 * registers the date-typed ones itself. Their date-shaped values are also kept in order, by the
 * {@link DatedValueIndex} each {@link PropertyValues} feeds. The registered names
 * are saved with the index, in a JSON file in this plugin's own folder, which is what lets the index answer
 * at the next startup straight from disk — before the metadata cache is ready, and before the consumer that
 * registered the property has even loaded.
 *
 * Owned by the plugin rather than by the module's component, like the heading times index, because a
 * registration must survive the module being switched off and on again; it gates itself on the module's
 * toggle.
 */

import type {
  App,
  FrontMatterCache
} from 'obsidian';

import type {
  DatedValue,
  DatedValuesQuery
} from '../../plugin-api.ts';
import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';

import { DatedValueIndex } from './dated-value-index.ts';

interface PersistedPropertyValues {
  /**
   * For each registered property name: each note carrying it, and its values.
   */
  readonly properties: Record<string, Record<string, readonly string[]>>;
  readonly version: typeof PERSISTED_VERSION;
}

interface PropertyValueIndexConstructorParams {
  readonly app: App;
  readonly getDataFilePath: () => string;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface PropertyValueIndexRefreshParams {
  readonly frontmatter: FrontMatterCache | undefined;
  readonly path: string;
}

/**
 * One registered property: the values of each note carrying it, and the reverse.
 */
class PropertyValues {
  public readonly pathsByValue = new Map<string, Set<string>>();
  public readonly valuesByPath = new Map<string, readonly string[]>();

  public constructor(private readonly propertyName: string, private readonly datedValueIndex: DatedValueIndex) {}

  public delete(path: string): boolean {
    const values = this.valuesByPath.get(path);

    if (!values) {
      return false;
    }

    this.valuesByPath.delete(path);

    for (const value of values) {
      this.datedValueIndex.remove({ path, propertyName: this.propertyName, value });
      const paths = this.pathsByValue.get(value);
      paths?.delete(path);

      if (paths?.size === 0) {
        this.pathsByValue.delete(value);
      }
    }

    return true;
  }

  /**
   * Sets a note's values. A note whose property holds no value it can be found by is still recorded, with
   * none, because it still CARRIES the property.
   *
   * @param path - The note's vault-relative path.
   * @param values - Its values, or `null` when it does not carry the property.
   * @returns Whether anything changed.
   */
  public set(path: string, values: null | readonly string[]): boolean {
    const oldValues = this.valuesByPath.get(path);

    if (values === null ? oldValues === undefined : oldValues !== undefined && areSameValues(oldValues, values)) {
      return false;
    }

    this.delete(path);

    if (values === null) {
      return true;
    }

    this.valuesByPath.set(path, values);

    for (const value of values) {
      this.datedValueIndex.add({ path, propertyName: this.propertyName, value });
      let paths = this.pathsByValue.get(value);

      if (!paths) {
        paths = new Set<string>();
        this.pathsByValue.set(value, paths);
      }

      paths.add(path);
    }

    return true;
  }
}

const PERSISTED_VERSION = 1;

/**
 * Answers which notes carry a registered frontmatter property, and which hold a given value of it.
 */
export class PropertyValueIndex {
  /**
   * Whether anything changed since the last save.
   */
  public get isDirty(): boolean {
    return this.isDirtyValue;
  }

  private readonly app: App;
  private readonly datedValueIndex = new DatedValueIndex();
  private readonly getDataFilePath: () => string;
  private isDirtyValue = false;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly propertyValuesByName = new Map<string, PropertyValues>();

  public constructor(params: PropertyValueIndexConstructorParams) {
    this.app = params.app;
    this.getDataFilePath = params.getDataFilePath;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  /**
   * Forgets every value held in memory, keeping the registered names. The file on disk is left alone.
   */
  public clear(): void {
    this.datedValueIndex.clear();

    for (const propertyName of this.propertyValuesByName.keys()) {
      this.propertyValuesByName.set(propertyName, new PropertyValues(propertyName, this.datedValueIndex));
    }

    this.isDirtyValue = false;
  }

  /**
   * Forgets one note.
   *
   * @param path - The note's vault-relative path.
   */
  public delete(path: string): void {
    for (const propertyValues of this.propertyValuesByName.values()) {
      this.isDirtyValue = propertyValues.delete(path) || this.isDirtyValue;
    }
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
   * Answers the published question: which date-shaped values fall in a range, in order?
   *
   * @param query - The range, and the properties to read.
   * @returns The values, in order; `null` when the query names a property nobody registered and while the
   *   `Properties` module is off.
   */
  public getDatedValues(query: DatedValuesQuery): DatedValue[] | null {
    if (!this.pluginSettingsComponent.settings.isPropertiesModuleEnabled) {
      return null;
    }

    const propertyNames = query.propertyNames ? new Set(query.propertyNames) : null;

    return propertyNames && [...propertyNames].some((propertyName) => !this.propertyValuesByName.has(propertyName)) ? null : this.datedValueIndex.getDatedValues(query, (propertyName) => propertyNames?.has(propertyName) ?? true);
  }

  /**
   * Answers the published question: which notes hold this value of this property?
   *
   * @param propertyName - The property name.
   * @param value - The value, as a scalar holds it or as one member of a list.
   * @returns The notes' vault-relative paths; `null` for a property nobody registered and while the
   *   `Properties` module is off.
   */
  public getPathsByPropertyValue(propertyName: string, value: string): null | string[] {
    const propertyValues = this.getPropertyValues(propertyName);
    return propertyValues ? [...propertyValues.pathsByValue.get(value) ?? []] : null;
  }

  /**
   * Answers the published question: which notes carry this property at all?
   *
   * @param propertyName - The property name.
   * @returns The notes' vault-relative paths; `null` for a property nobody registered and while the
   *   `Properties` module is off.
   */
  public getPathsWithProperty(propertyName: string): null | string[] {
    const propertyValues = this.getPropertyValues(propertyName);
    return propertyValues ? [...propertyValues.valuesByPath.keys()] : null;
  }

  /**
   * Lists the registered property names.
   *
   * @returns The names, in the order they were first registered.
   */
  public getPropertyNames(): string[] {
    return [...this.propertyValuesByName.keys()];
  }

  /**
   * Reads the saved state, replacing the values held in memory. The saved property names join the
   * registered ones. A missing or unreadable file is an empty index, rebuilt once the metadata cache is
   * ready.
   */
  public async load(): Promise<void> {
    this.clear();
    const dataFilePath = this.getDataFilePath();

    if (!await this.app.vault.adapter.exists(dataFilePath)) {
      return;
    }

    const persisted = parsePersistedPropertyValues(await this.app.vault.adapter.read(dataFilePath));

    for (const [propertyName, valuesByPath] of Object.entries(persisted?.properties ?? {})) {
      const propertyValues = new PropertyValues(propertyName, this.datedValueIndex);

      for (const [path, values] of Object.entries(valuesByPath)) {
        propertyValues.set(path, values);
      }

      this.propertyValuesByName.set(propertyName, propertyValues);
    }
  }

  /**
   * Re-reads one note's registered properties from its frontmatter.
   *
   * @param params - The note's path and its frontmatter.
   */
  public refresh(params: PropertyValueIndexRefreshParams): void {
    const { frontmatter, path } = params;

    for (const [propertyName, propertyValues] of this.propertyValuesByName) {
      this.isDirtyValue = propertyValues.set(path, readPropertyValues(frontmatter, propertyName)) || this.isDirtyValue;
    }
  }

  /**
   * Starts indexing a property. A name already registered, this session or a previous one, is left as it
   * is.
   *
   * @param propertyName - The property name.
   * @returns Whether the name is new, and so has nothing indexed yet.
   */
  public register(propertyName: string): boolean {
    if (this.propertyValuesByName.has(propertyName)) {
      return false;
    }

    this.propertyValuesByName.set(propertyName, new PropertyValues(propertyName, this.datedValueIndex));
    this.isDirtyValue = true;
    return true;
  }

  /**
   * Moves one note's values to its new path. Its frontmatter did not change, so nothing is re-read.
   *
   * @param oldPath - The path it had.
   * @param newPath - The path it has.
   */
  public rename(oldPath: string, newPath: string): void {
    for (const propertyValues of this.propertyValuesByName.values()) {
      const values = propertyValues.valuesByPath.get(oldPath);

      if (!values) {
        continue;
      }

      propertyValues.delete(oldPath);
      propertyValues.set(newPath, values);
      this.isDirtyValue = true;
    }
  }

  /**
   * Moves the values of every note under a folder to the folder's new path.
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
   * Forgets every note not among the given paths: the ones deleted, or renamed, while nothing was watching.
   *
   * @param paths - The vault-relative paths of the notes that are still there.
   */
  public retain(paths: ReadonlySet<string>): void {
    for (const propertyValues of this.propertyValuesByName.values()) {
      // Deleting the entry being visited is safe while iterating a `Map`.
      for (const path of propertyValues.valuesByPath.keys()) {
        if (paths.has(path)) {
          continue;
        }

        propertyValues.delete(path);
        this.isDirtyValue = true;
      }
    }
  }

  /**
   * Writes the state to disk.
   *
   * The JSON is built synchronously, before the first `await`, so a caller may clear the index straight
   * after calling this and still have the state it held saved.
   */
  public async save(): Promise<void> {
    const persisted: PersistedPropertyValues = {
      properties: Object.fromEntries(
        [...this.propertyValuesByName].map(([propertyName, propertyValues]) => [propertyName, Object.fromEntries(propertyValues.valuesByPath)])
      ),
      version: PERSISTED_VERSION
    };
    const json = JSON.stringify(persisted);
    this.isDirtyValue = false;
    await this.app.vault.adapter.write(this.getDataFilePath(), json);
  }

  private getPathsUnder(folderPath: string): string[] {
    const prefix = `${folderPath}/`;
    const paths = new Set<string>();

    for (const propertyValues of this.propertyValuesByName.values()) {
      for (const path of propertyValues.valuesByPath.keys()) {
        if (path.startsWith(prefix)) {
          paths.add(path);
        }
      }
    }

    return [...paths];
  }

  private getPropertyValues(propertyName: string): null | PropertyValues {
    return this.pluginSettingsComponent.settings.isPropertiesModuleEnabled ? this.propertyValuesByName.get(propertyName) ?? null : null;
  }
}

/**
 * Reads the values a note's property can be found by.
 *
 * A string, a number or a boolean is one value, in its string form; a list contributes each such member;
 * `null`, an object, and a list member that is neither contribute nothing. Repeats are dropped.
 *
 * @param frontmatter - The note's frontmatter.
 * @param propertyName - The property name, matched exactly.
 * @returns The values, or `null` when the note does not carry the property at all.
 */
export function readPropertyValues(frontmatter: FrontMatterCache | undefined, propertyName: string): null | string[] {
  if (!frontmatter || !Object.hasOwn(frontmatter, propertyName)) {
    return null;
  }

  const value: unknown = frontmatter[propertyName];
  const members: unknown[] = Array.isArray(value) ? value : [value];
  const values = new Set<string>();

  for (const member of members) {
    if (typeof member === 'string' || typeof member === 'number' || typeof member === 'boolean') {
      values.add(String(member));
    }
  }

  return [...values];
}

function areSameValues(values1: readonly string[], values2: readonly string[]): boolean {
  return values1.length === values2.length && values1.every((value, index) => value === values2[index]);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((member) => typeof member === 'string');
}

/**
 * Reads the saved file, keeping every note whose entry is well-formed and dropping the rest.
 *
 * @param json - The file's text.
 * @returns The saved state, or `null` when the file is not this format at all.
 */
function parsePersistedPropertyValues(json: string): null | PersistedPropertyValues {
  let value: unknown;

  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }

  const persisted = value as null | Partial<Record<keyof PersistedPropertyValues, unknown>>;

  if (persisted?.version !== PERSISTED_VERSION || typeof persisted.properties !== 'object' || persisted.properties === null) {
    return null;
  }

  const properties: Record<string, Record<string, readonly string[]>> = {};

  for (const [propertyName, valuesByPath] of Object.entries(persisted.properties)) {
    if (typeof valuesByPath !== 'object' || valuesByPath === null || Array.isArray(valuesByPath)) {
      continue;
    }

    properties[propertyName] = Object.fromEntries(
      Object.entries(valuesByPath).flatMap(([path, values]: [string, unknown]): [string, string[]][] => isStringArray(values) ? [[path, values]] : [])
    );
  }

  return { properties, version: PERSISTED_VERSION };
}
