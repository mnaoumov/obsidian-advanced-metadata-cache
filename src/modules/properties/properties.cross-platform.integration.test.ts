/**
 * @file
 *
 * Integration suite for the `Properties` module, against a real Obsidian:
 *
 * - A registered property answers by value — a scalar and a list member alike — and by presence.
 * - The answer follows an edit of the frontmatter and a rename of the note.
 * - The registration and the values are saved to `property-values.json` in the plugin folder.
 * - Assigning the `date` type to a property registers it with no consumer asking, and its values answer by
 *   range and by recurring month and day — which also pins that `metadataTypeManager` fires `changed`.
 * - A property whose name matches the default `*Date` is indexed with no type, a value with an offset or a
 *   time zone is ordered by the time as written, and a value that is not a date is listed apart — which also
 *   pins that Obsidian's frontmatter parser keeps an unquoted offset datetime a string.
 * - Switching the module off answers `null`.
 *
 * Named `*.cross-platform.integration.test.ts` so the desktop AND android projects both collect it:
 * none of this is platform-specific, and the API is the one a consumer calls on either.
 */

import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterAll,
  describe,
  expect,
  it
} from 'vitest';

import { applyPluginSettings } from '../../../scripts/helpers/names-module.ts';

/**
 * The published API, as a consumer compiles against it — the slice the root `api.d.ts` declares that
 * this suite calls.
 *
 * Declared here rather than imported, because an `evalInObsidian` closure is type-checked in this
 * module's scope but cannot carry a value across.
 */
interface AdvancedMetadataCacheApi {
  getDatedValues: (query: DatedValuesQuery) => DatedValue[] | null;
  getDatedValuesSafe: (query: DatedValuesQuery) => Promise<DatedValue[] | null>;
  getNonDateValuesSafe: () => Promise<DatedValue[] | null>;
  getPathsByPropertyValue: (propertyName: string, value: string) => null | string[];
  getPathsByPropertyValueSafe: (propertyName: string, value: string) => Promise<null | string[]>;
  getPathsWithPropertySafe: (propertyName: string) => Promise<null | string[]>;
  registerPropertyName: (propertyName: string) => void;
}

interface DatedValue {
  readonly path: string;
  readonly propertyName: string;
  readonly value: string;
}

interface DatedValuesQuery {
  readonly from?: string;
  readonly isRecurring?: boolean;
  readonly propertyNames?: readonly string[];
  readonly to?: string;
}

/**
 * What one run of the dated-values scenario answered.
 */
interface DatedValuesResult {
  readonly all: DatedValue[] | null;
  readonly error: null | string;
  readonly range: DatedValue[] | null;
  readonly recurring: DatedValue[] | null;
}

/**
 * Obsidian's own property widgets, as far as this suite reads them.
 */
interface MetadataTypeWidgetsHolder {
  readonly registeredTypeWidgets?: Record<string, PropertyWidget | undefined>;
}

/**
 * What one run of the named-dates scenario answered.
 */
interface NamedDatesResult {
  readonly dateWidgetShows: null | Record<string, null | string>;
  readonly dateWidgetWrites: null | unknown[];
  readonly day: DatedValue[] | null;
  readonly error: null | string;
  readonly nonDates: DatedValue[] | null;
  readonly reduced: DatedValue[] | null;
  /**
   * The JavaScript type the metadata cache hands over for an unquoted `2019`.
   */
  readonly unquotedYearType: null | string;
}

interface ObsidianLibStateBag {
  readonly pluginApiRegistry?: PluginApiRegistryWrapper;
}

interface PluginApiRecord {
  readonly api: AdvancedMetadataCacheApi;
  readonly apiVersion: string;
  readonly isRevoked: boolean;
}

interface PluginApiRegistry {
  readonly records?: Record<string, PluginApiRecord[] | undefined>;
}

interface PluginApiRegistryHolder {
  readonly __obsidianLib?: ObsidianLibStateBag;
}

interface PluginApiRegistryWrapper {
  readonly value?: PluginApiRegistry;
}

/**
 * What one run of the scenario answered.
 */
interface PropertiesResult {
  readonly afterEdit: null | string[];
  readonly afterRename: null | string[];
  readonly apiVersion: string;
  readonly byListMember: null | string[];
  readonly byScalar: null | string[];
  readonly error: null | string;
  readonly removedValue: null | string[];
  readonly savedPaths: null | string[];
  readonly withProperty: null | string[];
}

/**
 * One of Obsidian's own property widgets, as far as this suite renders it.
 */
interface PropertyWidget {
  readonly render?: (containerEl: HTMLElement, value: unknown, context: PropertyWidgetContext) => unknown;
}

interface PropertyWidgetContext {
  readonly app: unknown;
  readonly blur: () => void;
  readonly key: string;
  readonly onChange: (value: unknown) => void;
  readonly sourcePath: string;
}

/**
 * The saved index, as far as this suite reads it.
 */
interface SavedPropertyValues {
  readonly properties?: Record<string, Record<string, unknown>>;
}

const PROPERTY_NAME = 'properties-integration-keys';
const LIST_NOTE_PATH = 'properties-list.md';
const SCALAR_NOTE_PATH = 'properties-scalar.md';
const RENAMED_NOTE_PATH = 'properties-renamed.md';
const LIST_NOTE_CONTENT = `---\n${PROPERTY_NAME}:\n  - alpha\n  - beta\n---\n# List\n`;
const SCALAR_NOTE_CONTENT = `---\n${PROPERTY_NAME}: beta\n---\n# Scalar\n`;
const DATE_PROPERTY_NAME = 'properties-integration-date';
const DATED_NOTES: readonly (readonly [string, string])[] = [
  ['properties-dated-1.md', '1990-10-26'],
  ['properties-dated-2.md', '2026-03-01'],
  ['properties-dated-3.md', '2026-12-31']
];
const NAMED_DATE_PROPERTY_NAME = 'properties-integration-reviewDate';
// The offset value is left unquoted, as Obsidian itself writes a datetime.
const NAMED_DATE_NOTES: readonly (readonly [string, string, string])[] = [
  ['properties-named-1.md', '2026-10-26T23:00-06:00', '2026-10-26T23:00-06:00'],
  ['properties-named-2.md', '"2026-10-26T09:00+02:00[Europe/Kyiv]"', '2026-10-26T09:00+02:00[Europe/Kyiv]'],
  ['properties-named-3.md', '"14:30"', '14:30'],
  // A year left unquoted is a YAML integer; a month is quoted only to keep the two forms apart.
  ['properties-named-4.md', '2019', '2019'],
  ['properties-named-5.md', '"2019-05"', '2019-05']
];

/*
 * Every wait is for work already in flight. Their SUM (25 s, the change wait counted twice) has to stay under the transport's
 * per-command cap, since this closure holds one `Runtime.evaluate` open for the whole scenario. The save
 * wait covers the module's 5 s save debounce.
 */
const API_WAIT_IN_MS = 3000;
const CHANGE_WAIT_IN_MS = 5000;
const SAVE_WAIT_IN_MS = 12_000;
const POLL_IN_MS = 100;
const SCENARIO_TIMEOUT_IN_MS = 120_000;

describe('Properties module', () => {
  afterAll(async () => {
    // On by default; a case below switches it off, and the vault is shared with every other suite.
    await applyPluginSettings({ isPropertiesModuleEnabled: true });
  }, SCENARIO_TIMEOUT_IN_MS);

  it('answers by value and by presence, follows edits and renames, and saves the index', async () => {
    const result = await runScenario();

    expect(result.error).toBeNull();
    expect(result.apiVersion.startsWith('1.')).toBe(true);
    expect(result.byListMember).toEqual([LIST_NOTE_PATH]);
    expect(sortPaths(result.byScalar)).toEqual(sortPaths([LIST_NOTE_PATH, SCALAR_NOTE_PATH]));
    expect(sortPaths(result.withProperty)).toEqual(sortPaths([LIST_NOTE_PATH, SCALAR_NOTE_PATH]));
    expect(result.afterEdit).toEqual([LIST_NOTE_PATH]);
    expect(result.removedValue).toEqual([]);
    expect(result.afterRename).toEqual([RENAMED_NOTE_PATH]);
    expect(sortPaths(result.savedPaths)).toEqual(sortPaths([RENAMED_NOTE_PATH, SCALAR_NOTE_PATH]));
  }, SCENARIO_TIMEOUT_IN_MS);

  it('registers a property once it is given the date type, and answers it by range and by recurring date', async () => {
    const result = await runDatedValuesScenario();
    const [note1, note2, note3] = DATED_NOTES.map(([path, value]) => ({ path, propertyName: DATE_PROPERTY_NAME, value }));

    expect(result.error).toBeNull();
    expect(result.all).toEqual([note1, note2, note3]);
    expect(result.range).toEqual([note2]);
    expect(result.recurring).toEqual([note1, note3]);
  }, SCENARIO_TIMEOUT_IN_MS);

  it('indexes a property by its name, orders zoned values by the time as written, and lists the values that are not dates', async () => {
    const result = await runNamedDatesScenario();
    const [note1, note2, note3, note4, note5] = NAMED_DATE_NOTES.map(([path, , value]) => ({ path, propertyName: NAMED_DATE_PROPERTY_NAME, value }));

    expect(result.error).toBeNull();
    expect(result.day).toEqual([note2, note1]);
    expect(result.nonDates?.filter((entry) => entry.propertyName === NAMED_DATE_PROPERTY_NAME)).toEqual([note3]);
    expect(result.unquotedYearType).toBe('number');
    expect(result.reduced).toEqual([note4, note5]);
    // Obsidian's own date widget shows each as the first day of its period, which the README warns about;
    // showing it writes nothing back.
    expect(result.dateWidgetShows).toEqual({ '2019': '2019-01-01', '2019-05': '2019-05-01' });
    expect(result.dateWidgetWrites).toEqual([]);
  }, SCENARIO_TIMEOUT_IN_MS);

  it('answers null while the module is off', async () => {
    const switchOff = await applyPluginSettings({ isPropertiesModuleEnabled: false });
    expect(switchOff.error).toBeNull();

    const answer = await evalInObsidian({
      callback({ PROPERTY_NAME: propertyName }) {
        const records = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
        const record = (records?.['advanced-metadata-cache'] ?? []).find((candidate) => !candidate.isRevoked);
        return record ? record.api.getPathsByPropertyValue(propertyName, 'gamma') : 'no record';
      },
      input: { PROPERTY_NAME },
      vaultPath: getTemporaryVault().path
    });

    expect(answer).toBeNull();
  }, SCENARIO_TIMEOUT_IN_MS);
});

/**
 * Creates notes carrying a property nobody registered, gives the property the `date` type and asks the
 * dated questions about it. The type is removed again at the end, since the vault is shared.
 *
 * @returns What the plugin answered.
 */
async function runDatedValuesScenario(): Promise<DatedValuesResult> {
  return evalInObsidian({
    async callback({
      API_WAIT_IN_MS: apiWaitMs,
      app,
      CHANGE_WAIT_IN_MS: changeWaitMs,
      DATE_PROPERTY_NAME: propertyName,
      DATED_NOTES: datedNotes,
      lib: { waitUntil },
      POLL_IN_MS: pollMs
    }) {
      const empty: DatedValuesResult = { all: null, error: null, range: null, recurring: null };

      function readLiveRecord(): PluginApiRecord | undefined {
        const records = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
        return (records?.['advanced-metadata-cache'] ?? []).find((record) => !record.isRevoked);
      }

      try {
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the plugin to publish its API to the registry',
          predicate: () => readLiveRecord() !== undefined,
          timeoutInMilliseconds: apiWaitMs
        });

        const api = readLiveRecord()?.api;

        if (!api) {
          return { ...empty, error: 'No live API record' };
        }

        const files: TFile[] = [];

        for (const [path, value] of datedNotes) {
          const existing = app.vault.getAbstractFileByPath(path);

          if (existing) {
            await app.fileManager.trashFile(existing);
          }

          files.push(await app.vault.create(path, `---\n${propertyName}: ${value}\n---\n`));
        }

        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the metadata cache to parse the dated notes',
          predicate: () => files.every((file) => app.metadataCache.getFileCache(file)?.frontmatter?.[propertyName] !== undefined),
          timeoutInMilliseconds: changeWaitMs
        });

        // Nobody registered it, and it has no type yet, so it is not indexed.
        if (api.getDatedValues({ propertyNames: [propertyName] }) !== null) {
          return { ...empty, error: 'The property was indexed before it had a date type' };
        }

        await app.metadataTypeManager.setType(propertyName, 'date');

        try {
          await waitUntil({
            intervalInMilliseconds: pollMs,
            message: 'the date type to register the property',
            predicate: () => (api.getDatedValues({ propertyNames: [propertyName] }) ?? []).length === datedNotes.length,
            timeoutInMilliseconds: changeWaitMs
          });

          return {
            ...empty,
            all: await api.getDatedValuesSafe({ propertyNames: [propertyName] }),
            range: api.getDatedValues({ from: '2026', propertyNames: [propertyName], to: '2026-06' }),
            recurring: api.getDatedValues({ from: '10', isRecurring: true, propertyNames: [propertyName], to: '12' })
          };
        } finally {
          await app.metadataTypeManager.unsetType(propertyName);
        }
      } catch (error) {
        return { ...empty, error: String(error) };
      }
    },
    input: {
      API_WAIT_IN_MS,
      CHANGE_WAIT_IN_MS,
      DATE_PROPERTY_NAME,
      DATED_NOTES,
      POLL_IN_MS
    },
    vaultPath: getTemporaryVault().path
  });
}

/**
 * Creates notes carrying a property nobody registered and nobody typed, whose name alone makes it a date
 * property, and asks the dated questions about it.
 *
 * @returns What the plugin answered.
 */
async function runNamedDatesScenario(): Promise<NamedDatesResult> {
  return evalInObsidian({
    async callback({
      API_WAIT_IN_MS: apiWaitMs,
      app,
      CHANGE_WAIT_IN_MS: changeWaitMs,
      lib: { waitUntil },
      NAMED_DATE_NOTES: namedDateNotes,
      NAMED_DATE_PROPERTY_NAME: propertyName,
      POLL_IN_MS: pollMs
    }) {
      const empty: NamedDatesResult = { dateWidgetShows: null, dateWidgetWrites: null, day: null, error: null, nonDates: null, reduced: null, unquotedYearType: null };

      function readLiveRecord(): PluginApiRecord | undefined {
        const records = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
        return (records?.['advanced-metadata-cache'] ?? []).find((record) => !record.isRevoked);
      }

      try {
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the plugin to publish its API to the registry',
          predicate: () => readLiveRecord() !== undefined,
          timeoutInMilliseconds: apiWaitMs
        });

        const api = readLiveRecord()?.api;

        if (!api) {
          return { ...empty, error: 'No live API record' };
        }

        const files: TFile[] = [];

        for (const [path, yamlValue] of namedDateNotes) {
          const existing = app.vault.getAbstractFileByPath(path);

          if (existing) {
            await app.fileManager.trashFile(existing);
          }

          files.push(await app.vault.create(path, `---\n${propertyName}: ${yamlValue}\n---\n`));
        }

        // Four dates and one value that is not: both answers fill as the metadata cache parses the notes.
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the name to register the property and index the notes',
          predicate: async () =>
            (api.getDatedValues({ propertyNames: [propertyName] }) ?? []).length === namedDateNotes.length - 1
            && ((await api.getNonDateValuesSafe()) ?? []).some((entry) => entry.propertyName === propertyName),
          timeoutInMilliseconds: changeWaitMs
        });

        const unquotedYearFile = files.find((file) => file.path === 'properties-named-4.md');
        const dateWidget = (app.metadataTypeManager as MetadataTypeWidgetsHolder).registeredTypeWidgets?.['date'];
        const dateWidgetShows: Record<string, null | string> = {};
        const dateWidgetWrites: unknown[] = [];

        for (const value of [2019, '2019-05']) {
          const containerEl = createDiv();
          dateWidget?.render?.(containerEl, value, {
            app,
            blur(): void {
              // Nothing to blur in a detached element.
            },
            key: propertyName,
            onChange(newValue): void {
              dateWidgetWrites.push(newValue);
            },
            sourcePath: unquotedYearFile?.path ?? ''
          });
          dateWidgetShows[String(value)] = containerEl.querySelector('input')?.value ?? null;
        }

        return {
          ...empty,
          dateWidgetShows,
          dateWidgetWrites,
          day: await api.getDatedValuesSafe({ from: '2026-10-26', propertyNames: [propertyName], to: '2026-10-26' }),
          nonDates: await api.getNonDateValuesSafe(),
          reduced: api.getDatedValues({ from: '2019-05-10', propertyNames: [propertyName], to: '2019-05-20' }),
          unquotedYearType: unquotedYearFile ? typeof app.metadataCache.getFileCache(unquotedYearFile)?.frontmatter?.[propertyName] : null
        };
      } catch (error) {
        return { ...empty, error: String(error) };
      }
    },
    input: {
      API_WAIT_IN_MS,
      CHANGE_WAIT_IN_MS,
      NAMED_DATE_NOTES,
      NAMED_DATE_PROPERTY_NAME,
      POLL_IN_MS
    },
    vaultPath: getTemporaryVault().path
  });
}

/**
 * Creates the fixture notes, registers the property and asks every documented question about them.
 *
 * @returns What the plugin answered.
 */
async function runScenario(): Promise<PropertiesResult> {
  return evalInObsidian({
    async callback({
      API_WAIT_IN_MS: apiWaitMs,
      app,
      CHANGE_WAIT_IN_MS: changeWaitMs,
      lib: { waitUntil },
      LIST_NOTE_CONTENT: listNoteContent,
      LIST_NOTE_PATH: listNotePath,
      POLL_IN_MS: pollMs,
      PROPERTY_NAME: propertyName,
      RENAMED_NOTE_PATH: renamedNotePath,
      SAVE_WAIT_IN_MS: saveWaitMs,
      SCALAR_NOTE_CONTENT: scalarNoteContent,
      SCALAR_NOTE_PATH: scalarNotePath
    }) {
      const empty: PropertiesResult = {
        afterEdit: null,
        afterRename: null,
        apiVersion: '',
        byListMember: null,
        byScalar: null,
        error: null,
        removedValue: null,
        savedPaths: null,
        withProperty: null
      };

      for (const path of [listNotePath, scalarNotePath, renamedNotePath]) {
        const existing = app.vault.getAbstractFileByPath(path);

        if (existing) {
          await app.fileManager.trashFile(existing);
        }
      }

      function readLiveRecord(): PluginApiRecord | undefined {
        const records = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
        return (records?.['advanced-metadata-cache'] ?? []).find((record) => !record.isRevoked);
      }

      try {
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the plugin to publish its API to the registry',
          predicate: () => readLiveRecord() !== undefined,
          timeoutInMilliseconds: apiWaitMs
        });

        const record = readLiveRecord();

        if (!record) {
          return { ...empty, error: 'No live API record' };
        }

        const api = record.api;
        api.registerPropertyName(propertyName);

        const listNote = await app.vault.create(listNotePath, listNoteContent);
        await app.vault.create(scalarNotePath, scalarNoteContent);

        // `vault.create` resolves before the metadata cache has parsed the notes; the index follows `changed`.
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the index to pick up both new notes',
          predicate: () => (api.getPathsByPropertyValue(propertyName, 'beta') ?? []).length === 2,
          timeoutInMilliseconds: changeWaitMs
        });

        const byListMember = await api.getPathsByPropertyValueSafe(propertyName, 'alpha');
        const byScalar = await api.getPathsByPropertyValueSafe(propertyName, 'beta');
        const withProperty = await api.getPathsWithPropertySafe(propertyName);

        await app.fileManager.processFrontMatter(listNote, (frontmatter: Record<string, unknown>) => {
          frontmatter[propertyName] = ['gamma'];
        });

        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the index to follow the frontmatter edit',
          predicate: () => (api.getPathsByPropertyValue(propertyName, 'gamma') ?? []).length === 1,
          timeoutInMilliseconds: changeWaitMs
        });

        const afterEdit = api.getPathsByPropertyValue(propertyName, 'gamma');
        const removedValue = api.getPathsByPropertyValue(propertyName, 'alpha');

        await app.fileManager.renameFile(listNote, renamedNotePath);
        const afterRename = api.getPathsByPropertyValue(propertyName, 'gamma');

        const plugin = app.plugins.getPlugin('advanced-metadata-cache');
        const dataFilePath = `${plugin?.manifest.dir ?? ''}/property-values.json`;
        let savedPaths: null | string[] = null;

        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the index to be saved with the renamed note',
          predicate: async () => {
            if (!await app.vault.adapter.exists(dataFilePath)) {
              return false;
            }

            const saved = JSON.parse(await app.vault.adapter.read(dataFilePath)) as SavedPropertyValues;
            savedPaths = Object.keys(saved.properties?.[propertyName] ?? {});
            return savedPaths.includes(renamedNotePath);
          },
          timeoutInMilliseconds: saveWaitMs
        });

        return { ...empty, afterEdit, afterRename, apiVersion: record.apiVersion, byListMember, byScalar, removedValue, savedPaths, withProperty };
      } catch (error) {
        return { ...empty, error: String(error) };
      }
    },
    input: {
      API_WAIT_IN_MS,
      CHANGE_WAIT_IN_MS,
      LIST_NOTE_CONTENT,
      LIST_NOTE_PATH,
      POLL_IN_MS,
      PROPERTY_NAME,
      RENAMED_NOTE_PATH,
      SAVE_WAIT_IN_MS,
      SCALAR_NOTE_CONTENT,
      SCALAR_NOTE_PATH
    },
    vaultPath: getTemporaryVault().path
  });
}

function sortPaths(paths: null | readonly string[]): null | string[] {
  return paths ? [...paths].sort() : null;
}
