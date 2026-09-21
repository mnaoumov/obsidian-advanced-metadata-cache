import type { LinkSuggestion } from '@obsidian-typings/obsidian-public-latest';
import type { App } from 'obsidian';

import {
  Component,
  Notice
} from 'obsidian';
import { configureCommunityPlugin } from 'obsidian-dev-utils/obsidian/community-plugins';
import { watchPluginApi } from 'obsidian-dev-utils/obsidian/plugin/plugin-api';

const PLUGIN_ID = 'advanced-metadata-cache';
const CENTRAL_TOPIC_PATH = 'Topics/Central topic.md';

const NAME_INDEX_WAIT_ATTEMPTS = 50;
const NAME_INDEX_POLL_IN_MILLISECONDS = 100;

interface AdvancedMetadataCacheApi {
  getTitlePropertyNames(): string[];
  getTitles(pathOrFile: string): string[];
}

interface DemoSettingsPatch {
  isBacklinksModuleEnabled?: boolean;
  isNamesModuleEnabled?: boolean;
  isTitlesModuleEnabled?: boolean;
  shouldAutomaticallyRefreshBacklinkPanels?: boolean;
  shouldShowProgressBarOnLoad?: boolean;
  titlePropertyNames?: string[];
}

/**
 * The shape `app.metadataCache.getLinkSuggestions` takes while the Names module is on. The same
 * shape `GetLinkSuggestionsFn` in the root `api.d.ts` ships for consumers.
 */
interface PatchedGetLinkSuggestions {
  (): LinkSuggestion[];
  getPathsByName?(name: string): string[];
  // eslint-disable-next-line unicorn/name-replacements -- `originalFn` is the plugin's documented public API - the README tells users to call it.
  originalFn?(): LinkSuggestion[];
  safe?(): Promise<LinkSuggestion[]>;
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
 * Manual equivalent: change the same option in **Settings -> Community plugins -> Advanced Metadata Cache**.
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
 * Metadata Cache**, then call `app.metadataCache.getLinkSuggestions.getPathsByName(name)`.
 *
 * @param app - The Obsidian app.
 * @param name - The name to look up.
 * @param patch - Any other settings to apply first, so one button can show a name appearing or
 *   disappearing as a module is switched.
 */
export async function showNamesFor(app: App, name: string, patch: DemoSettingsPatch = {}): Promise<void> {
  await configureCommunityPlugin({ app, pluginId: PLUGIN_ID, settings: { ...patch, isNamesModuleEnabled: true } });

  const getLinkSuggestions = await waitForNameIndex(app);

  if (!getLinkSuggestions?.getPathsByName || !getLinkSuggestions.originalFn) {
    new Notice('The Names module did not finish loading.');
    return;
  }

  const paths = getLinkSuggestions.getPathsByName(name);

  new Notice([
    `"${name}" names ${paths.length.toString()} note(s):`,
    ...paths,
    '',
    `indexed link targets: ${getLinkSuggestions().length.toString()}`,
    `built-in link targets: ${getLinkSuggestions.originalFn().length.toString()}`
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
 * Waits for the Names module to install its patch and build its index.
 *
 * The patch is installed as soon as the module loads, but the index is built once the metadata cache
 * can answer — so waiting for the patch alone would ask an empty index. `safe()` waits for the
 * build, which is why this returns only after calling it.
 */
async function waitForNameIndex(app: App): Promise<PatchedGetLinkSuggestions | null> {
  for (let attempt = 0; attempt < NAME_INDEX_WAIT_ATTEMPTS; attempt++) {
    const getLinkSuggestions = app.metadataCache.getLinkSuggestions as PatchedGetLinkSuggestions;

    if (getLinkSuggestions.safe) {
      await getLinkSuggestions.safe();
      return getLinkSuggestions;
    }

    await sleep(NAME_INDEX_POLL_IN_MILLISECONDS);
  }

  return null;
}
