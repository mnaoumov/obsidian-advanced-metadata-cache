import type { LinkSuggestion } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  Editor,
  TFile
} from 'obsidian';

import {
  Component,
  MarkdownView,
  Notice
} from 'obsidian';
import { configureCommunityPlugin } from '@mnaoumov/obsidian-lib/community-plugins';
import { watchPluginApi } from '@mnaoumov/obsidian-lib/plugin/plugin-api';

const PLUGIN_ID = 'advanced-metadata-cache';
const CENTRAL_TOPIC_PATH = 'Topics/Central topic.md';

const HEADING_TIMES_WAIT_ATTEMPTS = 50;
const HEADING_TIMES_POLL_IN_MILLISECONDS = 100;

const PLAYGROUND_PATH = 'Materials/05 Name index/Autocomplete playground.md';
const PLAYGROUND_CONTENT = `# Autocomplete playground

The **Try it in the editor** button in [05 Name index](<../../05 Name index.md>) types into this note. Type below
as well: \`[[\` opens the autocomplete, and the reset button there puts the note back.
`;
const RESEARCH_NOTE_PATH = 'Topics/Research note.md';
const EXPECTED_ALIAS = 'Literature review';
const TYPED_LINK_START = '[[Lit';
const SUGGESTION_WAIT_ATTEMPTS = 50;
const SUGGESTION_POLL_IN_MILLISECONDS = 100;

/**
 * The slice of the plugin API these buttons call. The same shape `AdvancedMetadataCacheApi` in the root
 * `api.d.ts` ships for consumers, with the backlinks dictionary narrowed to what is counted here.
 */
interface AdvancedMetadataCacheApi {
  getBacklinksForFile(pathOrFile: string): BacklinksDict | null;
  getBacklinksForFileOriginal(file: TFile): BacklinksDict;
  getBacklinksForFileSafe(pathOrFile: string): Promise<BacklinksDict | null>;
  getDatedValuesSafe(query: DatedValuesQuery): Promise<DatedValue[] | null>;
  getHeadingTimes(pathOrFile: string): HeadingTimes[];
  getLinkSuggestions(): LinkSuggestion[] | null;
  getLinkSuggestionsOriginal(): LinkSuggestion[];
  getLinkSuggestionsSafe(): Promise<LinkSuggestion[] | null>;
  getPathsByNameSafe(name: string): Promise<null | string[]>;
  getPathsByPropertyValueSafe(propertyName: string, value: string): Promise<null | string[]>;
  getPathsWithPropertySafe(propertyName: string): Promise<null | string[]>;
  getTitlePropertyNames(): string[];
  getTitles(pathOrFile: string): string[];
  registerPropertyName(propertyName: string): void;
}

interface BacklinksDict {
  count(): number;
}

/**
 * One dated value, as the plugin API reports it. The same shape `DatedValue` in the root `api.d.ts` ships.
 */
interface DatedValue {
  readonly path: string;
  readonly propertyName: string;
  readonly value: string;
}

/**
 * A range of dates, as the plugin API takes it. The same shape `DatedValuesQuery` in the root `api.d.ts` ships.
 */
interface DatedValuesQuery {
  readonly from?: string;
  readonly isRecurring?: boolean;
  readonly propertyNames?: readonly string[];
  readonly to?: string;
}

interface DemoSettingsPatch {
  isBacklinksModuleEnabled?: boolean;
  isHeadingsModuleEnabled?: boolean;
  isNamesModuleEnabled?: boolean;
  isPropertiesModuleEnabled?: boolean;
  isTitlesModuleEnabled?: boolean;
  shouldAutomaticallyRefreshBacklinkPanels?: boolean;
  shouldOfferTitlesInLinkSuggestions?: boolean;
  shouldShowProgressBarOnLoad?: boolean;
  titlePropertyNames?: string[];
}

/**
 * One heading's times, as the plugin API reports them. The same shape `HeadingTimes` in the root
 * `api.d.ts` ships for consumers.
 */
interface HeadingTimes {
  readonly created: null | number;
  readonly heading: string;
  readonly level: number;
  readonly line: number;
  readonly modified: null | number;
  readonly seen: null | number;
}

/**
 * Opens the note everything links to and reveals the core Backlinks pane beside it.
 *
 * The existing buttons query the cache through the API; this puts the UI that the same cache feeds on
 * screen, which is what the settings below are actually about.
 *
 * Manual equivalent: open `Topics/Central topic.md`, then run **Backlinks: Show backlinks**.
 */
export async function showCentralTopicBacklinks(app: App): Promise<void> {
  const note = app.vault.getFileByPath(CENTRAL_TOPIC_PATH);
  if (!note) {
    new Notice(`${CENTRAL_TOPIC_PATH} is missing from this vault.`);
    return;
  }

  await app.workspace.getLeaf(false).openFile(note);
  app.commands.executeCommandById('backlink:open-backlinks');
}

/**
 * Asks the plugin API for the central topic's backlinks three ways - fast, safe and original - and
 * reports how many each one found.
 *
 * Manual equivalent: take the API through `watchPluginApi` from your own plugin, then call
 * `getBacklinksForFile`, `getBacklinksForFileSafe` and `getBacklinksForFileOriginal`.
 */
export async function compareBacklinks(app: App): Promise<void> {
  const note = app.vault.getFileByPath(CENTRAL_TOPIC_PATH);
  if (!note) {
    new Notice(`${CENTRAL_TOPIC_PATH} is missing from this vault.`);
    return;
  }

  const api = await getApi(app);
  const fast = api.getBacklinksForFile(CENTRAL_TOPIC_PATH);
  const safe = await api.getBacklinksForFileSafe(CENTRAL_TOPIC_PATH);

  if (!fast || !safe) {
    new Notice('The Backlinks module is off. Switch it on in the plugin settings.');
    return;
  }

  new Notice([
    `fast:     ${fast.count().toString()}`,
    `safe:     ${safe.count().toString()}`,
    `original: ${api.getBacklinksForFileOriginal(note).count().toString()}`
  ].join('\n'));
}

/**
 * Rebuilds the visible Backlinks panes on demand.
 *
 * This is the command that matters when `shouldAutomaticallyRefreshBacklinkPanels` is off — which is
 * the default, so it is the behavior most readers actually have.
 *
 * Manual equivalent: **Advanced Metadata Cache: Refresh backlink panels** in the Command Palette.
 */
export function refreshBacklinkPanels(app: App): void {
  app.commands.executeCommandById(`${PLUGIN_ID}:refresh-backlink-panels`);
}

/**
 * Applies a settings patch, live, through the plugin's own settings component.
 *
 * Manual equivalent: change the same option in **Settings -> Community plugins -> `Advanced Metadata Cache`**.
 */
export async function changeSettings(app: App, patch: DemoSettingsPatch): Promise<void> {
  await configureCommunityPlugin({ app, pluginId: PLUGIN_ID, settings: patch });
  new Notice('Applied.');
}

/**
 * Switches the Names module on, waits for its index, and reports what the vault calls a given name.
 *
 * The module is off by default — every module added after the one this plugin was created for is —
 * so the button that calls this turns it on for you rather than leaving you to find the toggle.
 *
 * Manual equivalent: turn **Names module** on in **Settings -> Community plugins -> Advanced
 * Metadata Cache**, then call `getPathsByName(name)` on the API from your own plugin.
 *
 * @param app - The Obsidian app.
 * @param name - The name to look up.
 * @param patch - Any other settings to apply first, so one button can show a name appearing or
 *   disappearing as a module is switched.
 */
export async function showNamesFor(app: App, name: string, patch: DemoSettingsPatch = {}): Promise<void> {
  await configureCommunityPlugin({ app, pluginId: PLUGIN_ID, settings: { ...patch, isNamesModuleEnabled: true } });

  const api = await getApi(app);
  // The safe variant waits for the index to be built, which the module starts only once it loads.
  const paths = await api.getPathsByNameSafe(name);
  const indexed = api.getLinkSuggestions();

  if (!paths || !indexed) {
    new Notice('The Names module did not finish loading.');
    return;
  }

  new Notice([
    `"${name}" names ${paths.length.toString()} note(s):`,
    ...paths,
    '',
    `indexed link targets: ${indexed.length.toString()}`,
    `built-in link targets: ${api.getLinkSuggestionsOriginal().length.toString()}`
  ].join('\n'));
}

/**
 * Switches the Names module on, opens the autocomplete playground and types `[[Lit` at its end, so the
 * `[[` autocomplete opens on the list the index answered with.
 *
 * The text goes in as a typed input rather than a plain edit, because Obsidian opens the autocomplete
 * only for what the reader typed. The button then checks the popover it opened, and throws when the
 * popover does not offer the expected alias.
 *
 * Manual equivalent: turn **Names module** on in **Settings -> Community plugins -> `Advanced Metadata
 * Cache`**, open any note and type `[[Lit`.
 *
 * @param app - The Obsidian app.
 */
export async function typeLinkInPlayground(app: App): Promise<void> {
  await configureCommunityPlugin({ app, pluginId: PLUGIN_ID, settings: { isNamesModuleEnabled: true } });

  const api = await getApi(app);
  // The safe variant waits for the index to be built, so the popover is answered from it.
  const indexed = await api.getLinkSuggestionsSafe();

  if (!indexed?.some((suggestion) => suggestion.alias === EXPECTED_ALIAS && suggestion.file?.path === RESEARCH_NOTE_PATH)) {
    throw new Error(`The name index does not offer "${EXPECTED_ALIAS}" for ${RESEARCH_NOTE_PATH}.`);
  }

  const editor = await openPlaygroundEditor(app);
  const end = editor.cm.state.doc.length;
  const typed = `\n${TYPED_LINK_START}`;
  editor.cm.dispatch({
    changes: { from: end, insert: typed },
    selection: { anchor: end + typed.length },
    userEvent: 'input.type'
  });

  for (let attempt = 0; attempt < SUGGESTION_WAIT_ATTEMPTS; attempt++) {
    const offered = Array.from(activeDocument.querySelectorAll('.suggestion-container .suggestion-item'))
      .some((item) => item.textContent.includes(EXPECTED_ALIAS));

    if (offered) {
      new Notice(`The [[ autocomplete offers "${EXPECTED_ALIAS}", answered from the name index.`);
      return;
    }

    await sleep(SUGGESTION_POLL_IN_MILLISECONDS);
  }

  throw new Error(`The [[ autocomplete did not offer "${EXPECTED_ALIAS}".`);
}

/**
 * Puts the autocomplete playground back as it shipped, dropping whatever the button or the reader typed
 * into it.
 *
 * Manual equivalent: delete the lines you typed at the end of the playground note.
 *
 * @param app - The Obsidian app.
 */
export async function resetPlayground(app: App): Promise<void> {
  const file = app.vault.getFileByPath(PLAYGROUND_PATH);

  if (!file) {
    throw new Error(`${PLAYGROUND_PATH} is missing from this vault.`);
  }

  app.workspace.editorSuggest.close();
  await app.vault.process(file, () => PLAYGROUND_CONTENT);
  new Notice('The playground is back as it shipped.');
}

async function openPlaygroundEditor(app: App): Promise<Editor> {
  const file = app.vault.getFileByPath(PLAYGROUND_PATH);

  if (!file) {
    throw new Error(`${PLAYGROUND_PATH} is missing from this vault.`);
  }

  await app.vault.process(file, () => PLAYGROUND_CONTENT);
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file, { state: { mode: 'source' } });

  if (!(leaf.view instanceof MarkdownView)) {
    throw new Error(`${PLAYGROUND_PATH} did not open in an editor.`);
  }

  const editor = leaf.view.editor;
  editor.focus();
  return editor;
}

/**
 * Switches both modules on, sets whether titles are offered to the `[[` autocomplete, and reports
 * what the autocomplete would now be handed for one title.
 *
 * The two counts are the point. With the setting off they are equal — the list this plugin answers
 * with is the one Obsidian would have built — and with it on the indexed one is larger, by the title
 * entries appended to its end. The reported position says which: a title always lands at or past the
 * end of Obsidian's own list, never interleaved with it.
 *
 * Manual equivalent: turn **Names module**, **Titles module** and **Offer titles in the [[
 * autocomplete** on in **Settings -> Community plugins -> `Advanced Metadata Cache`**, then type `[[`
 * followed by the start of a title.
 *
 * @param app - The Obsidian app.
 * @param title - The title to look for among the offered link targets.
 * @param shouldOfferTitlesInLinkSuggestions - What to set the setting to first.
 */
export async function showAutocompleteOfferFor(app: App, title: string, shouldOfferTitlesInLinkSuggestions: boolean): Promise<void> {
  await configureCommunityPlugin({
    app,
    pluginId: PLUGIN_ID,
    settings: {
      isNamesModuleEnabled: true,
      isTitlesModuleEnabled: true,
      shouldOfferTitlesInLinkSuggestions
    }
  });

  const api = await getApi(app);
  const indexed = await api.getLinkSuggestionsSafe();

  if (!indexed) {
    new Notice('The Names module did not finish loading.');
    return;
  }

  const builtInCount = api.getLinkSuggestionsOriginal().length;
  const offeredIndex = indexed.findIndex((suggestion) => suggestion.alias === title);

  new Notice([
    `"Offer titles in the [[ autocomplete" is ${shouldOfferTitlesInLinkSuggestions ? 'ON' : 'OFF'}.`,
    `"${title}" is ${offeredIndex === -1 ? 'NOT offered' : `offered at position ${(offeredIndex + 1).toString()}`}.`,
    '',
    `indexed link targets: ${indexed.length.toString()}`,
    `built-in link targets: ${builtInCount.toString()}`
  ].join('\n'));
}

/**
 * Switches the Titles module on and reports what one note's own frontmatter says it is called.
 *
 * This is the forward half of the module, reached through the published plugin API rather than
 * through a patched Obsidian method - there is no built-in method for "what is this note called",
 * which is exactly why it is published.
 *
 * Manual equivalent: turn **Titles module** on in **Settings -> Community plugins -> Advanced
 * Metadata Cache**, then take the API through `watchPluginApi` from your own plugin.
 *
 * @param app - The Obsidian app.
 * @param path - The vault-relative path of the note to read.
 */
export async function showTitlesFor(app: App, path: string): Promise<void> {
  await configureCommunityPlugin({ app, pluginId: PLUGIN_ID, settings: { isTitlesModuleEnabled: true } });

  const component = new Component();
  component.load();

  try {
    const apiRef = watchPluginApi<AdvancedMetadataCacheApi>({
      apiVersionRange: '^1',
      app,
      component,
      pluginId: PLUGIN_ID
    });

    const api = await apiRef.whenAvailable();
    const propertyNames = api.getTitlePropertyNames();
    const titles = api.getTitles(path);

    new Notice([
      `"${path}" is titled:`,
      ...titles.length > 0 ? titles : ['(nothing)'],
      '',
      `read from: ${propertyNames.join(', ')}`
    ].join('\n'));
  } finally {
    component.unload();
  }
}

/**
 * Takes the plugin API from the registry, waiting for the plugin to publish it.
 *
 * @param app - The Obsidian app.
 * @returns The API, at contract `1.3.0` or later, which is where the backlinks and names calls arrived.
 */
async function getApi(app: App): Promise<AdvancedMetadataCacheApi> {
  const component = new Component();
  component.load();

  try {
    return await watchPluginApi<AdvancedMetadataCacheApi>({
      apiVersionRange: '^1.3',
      app,
      component,
      pluginId: PLUGIN_ID
    }).whenAvailable();
  } finally {
    component.unload();
  }
}

/**
 * Switches the Headings module on, opens a note so it is tracked, and reports when each of its headings
 * was created, last modified and last seen.
 *
 * Manual equivalent: turn **Headings module** on in **Settings -> Community plugins -> Advanced Metadata
 * Cache**, open the note, then call `getHeadingTimes(path)` on the API from your own plugin.
 *
 * @param app - The Obsidian app.
 * @param path - The vault-relative path of the note.
 */
export async function showHeadingTimesFor(app: App, path: string): Promise<void> {
  const api = await openTrackedNote(app, path);

  if (!api) {
    return;
  }

  new Notice([
    `"${path}":`,
    ...api.getHeadingTimes(path).map((heading) =>
      `${'#'.repeat(heading.level)} ${heading.heading}: created ${formatTime(heading.created, 'before tracking')}, modified ${
        formatTime(heading.modified, 'not since')
      }, seen ${formatTime(heading.seen, 'not yet')}`
    )
  ].join('\n'));
}

/**
 * Appends a new heading to a note, then reports the note's heading times, so the new one shows up as
 * created just now.
 *
 * Manual equivalent: type a new `## ` heading at the end of the note.
 *
 * @param app - The Obsidian app.
 * @param path - The vault-relative path of the note.
 */
export async function addHeadingTo(app: App, path: string): Promise<void> {
  const heading = `Entry ${new Date().toLocaleTimeString()}`;
  await editAndShowHeadingTimes(app, path, (content) => `${content.trimEnd()}\n\n## ${heading}\nAdded by the demo button.\n`, heading);
}

/**
 * Adds a line under one heading of a note, then reports the note's heading times, so that heading shows
 * up as modified just now and the others do not.
 *
 * Manual equivalent: type anything under that heading.
 *
 * @param app - The Obsidian app.
 * @param path - The vault-relative path of the note.
 * @param heading - The heading text to edit under.
 */
export async function editUnderHeading(app: App, path: string, heading: string): Promise<void> {
  const line = `Edited at ${new Date().toLocaleTimeString()}.`;
  await editAndShowHeadingTimes(app, path, (content) => content.replace(`## ${heading}\n`, `## ${heading}\n${line}\n`), heading);
}

async function editAndShowHeadingTimes(app: App, path: string, edit: (content: string) => string, heading: string): Promise<void> {
  const api = await openTrackedNote(app, path);
  const file = app.vault.getFileByPath(path);

  if (!api || !file) {
    return;
  }

  const startTime = Date.now();
  await app.vault.process(file, edit);

  for (let attempt = 0; attempt < HEADING_TIMES_WAIT_ATTEMPTS; attempt++) {
    const times = api.getHeadingTimes(path).find((candidate) => candidate.heading === heading);

    if ((times?.modified ?? 0) >= startTime) {
      break;
    }

    await sleep(HEADING_TIMES_POLL_IN_MILLISECONDS);
  }

  await showHeadingTimesFor(app, path);
}

/**
 * Registers a property, then reports which notes carry it and which of them hold one value of it.
 *
 * Manual equivalent: none - Obsidian has no index of notes by property value, which is what this module
 * is for. The closest is searching for `[status:reading]`, which reads every note.
 *
 * @param app - The Obsidian app.
 * @param propertyName - The property to register and ask about.
 * @param value - The value to look for.
 */
export async function showPathsByPropertyValue(app: App, propertyName: string, value: string): Promise<void> {
  await configureCommunityPlugin({ app, pluginId: PLUGIN_ID, settings: { isPropertiesModuleEnabled: true } });

  const component = new Component();
  component.load();

  try {
    const api = await watchPluginApi<AdvancedMetadataCacheApi>({
      apiVersionRange: '^1.4',
      app,
      component,
      pluginId: PLUGIN_ID
    }).whenAvailable();

    api.registerPropertyName(propertyName);
    const pathsWithProperty = await api.getPathsWithPropertySafe(propertyName) ?? [];
    const pathsWithValue = await api.getPathsByPropertyValueSafe(propertyName, value) ?? [];

    new Notice([
      `Notes carrying "${propertyName}": ${formatPaths(pathsWithProperty)}`,
      `Notes where "${propertyName}" holds "${value}": ${formatPaths(pathsWithValue)}`
    ].join('\n'));
  } finally {
    component.unload();
  }
}

/**
 * Reports the dated values a range matches, in order. A property whose type is `Date` is indexed with no
 * registration, so nothing is registered here.
 *
 * Manual equivalent: none - Obsidian has no ordered index of dates. The closest is a Bases view filtered
 * on the date, which reads every note.
 *
 * @param app - The Obsidian app.
 * @param query - The range, as `getDatedValues` takes it.
 */
export async function showDatedValues(app: App, query: DatedValuesQuery): Promise<void> {
  await configureCommunityPlugin({ app, pluginId: PLUGIN_ID, settings: { isPropertiesModuleEnabled: true } });

  const component = new Component();
  component.load();

  try {
    const api = await watchPluginApi<AdvancedMetadataCacheApi>({
      apiVersionRange: '^1.5',
      app,
      component,
      pluginId: PLUGIN_ID
    }).whenAvailable();

    const datedValues = await api.getDatedValuesSafe(query) ?? [];
    const lines = datedValues.map((datedValue) => `${datedValue.value}  ${datedValue.propertyName}  ${datedValue.path}`);

    new Notice([`Dated values from ${query.from ?? 'the start'} to ${query.to ?? 'the end'}:`, ...lines.length === 0 ? ['none'] : lines].join('\n'));
  } finally {
    component.unload();
  }
}

function formatPaths(paths: readonly string[]): string {
  return paths.length === 0 ? 'none' : [...paths].sort().join(', ');
}

function formatTime(time: null | number, fallback: string): string {
  return time === null ? fallback : new Date(time).toLocaleTimeString();
}

/**
 * Switches the Headings module on and opens the note, which is what starts tracking it.
 *
 * @param app - The Obsidian app.
 * @param path - The vault-relative path of the note.
 * @returns The API, or `null` when the note or the API is missing.
 */
async function openTrackedNote(app: App, path: string): Promise<AdvancedMetadataCacheApi | null> {
  const file = app.vault.getFileByPath(path);

  if (!file) {
    new Notice(`${path} is missing from this vault.`);
    return null;
  }

  await configureCommunityPlugin({ app, pluginId: PLUGIN_ID, settings: { isHeadingsModuleEnabled: true } });

  const component = new Component();
  component.load();

  try {
    const api = await watchPluginApi<AdvancedMetadataCacheApi>({
      apiVersionRange: '^1.2',
      app,
      component,
      pluginId: PLUGIN_ID
    }).whenAvailable();

    await app.workspace.getLeaf(false).openFile(file);
    return api;
  } finally {
    component.unload();
  }
}