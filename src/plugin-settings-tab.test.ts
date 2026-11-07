import type { PluginSettingsComponentBase } from '@mnaoumov/obsidian-lib/components/plugin-settings-component';
import type {
  Plugin,
  SettingDefinitionItem,
  SettingGroup
} from 'obsidian';
import type { Promisable } from 'type-fest';

import { SettingEx } from '@mnaoumov/obsidian-lib/setting-ex';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  Notice,
  ToggleComponent
} from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginDataSync } from './persistence/plugin-data-sync.ts';
import type { PluginSettings } from './plugin-settings.ts';

import { PluginSettingsTab } from './plugin-settings-tab.ts';

interface Harness {
  readonly bindParams: Map<string, unknown>;
  readonly containerEl: HTMLElement;
  readonly definitions: SettingDefinitionItem[];
  readonly pluginDataSync: PluginDataSync;
  readonly propertyNames: string[];
  readonly tab: PluginSettingsTab;
  readonly triggerModuleToggleChange: (propertyName: string) => Promise<void>;
}

interface ValueConverters {
  readonly componentToPluginSettingsValueConverter: (uiValue: readonly string[]) => unknown;
  readonly pluginSettingsToComponentValueConverter: (pluginSettingsValue: readonly (readonly string[])[]) => unknown;
}

interface VisibleHolder {
  readonly visible?: (() => boolean) | boolean;
}

function checkIsVisible(definition: SettingDefinitionItem | undefined): boolean {
  const { visible } = castTo<VisibleHolder>(definition);
  return typeof visible === 'function' ? visible() : visible !== false;
}

function createHarness(
  isBacklinksModuleEnabled: boolean,
  isTitlesModuleEnabled = false,
  isNamesModuleEnabled = false,
  pluginDataSync: PluginDataSync = createPluginDataSync()
): Harness {
  const settings = {
    codeBlockLinkLanguages: [],
    datePropertyNames: ['date', '*Date'],
    isBacklinksModuleEnabled,
    isCodeBlockLinksModuleEnabled: isBacklinksModuleEnabled,
    isHeadingsModuleEnabled: false,
    isNamesModuleEnabled,
    isNonMarkdownModuleEnabled: isBacklinksModuleEnabled,
    isPropertiesModuleEnabled: isBacklinksModuleEnabled,
    isTitlesModuleEnabled,
    isUnlinkedMentionsModuleEnabled: false,
    markdownFileExtensions: [],
    pluginDataFolder: 'Sync/Data',
    shouldAutomaticallyRefreshBacklinkPanels: false,
    shouldOfferTitlesInLinkSuggestions: false,
    shouldShowProgressBarOnLoad: true,
    titleNamePatterns: [],
    titlePropertyNames: ['title']
  };

  const pluginSettingsComponent = strictProxy<PluginSettingsComponentBase<PluginSettings>>({
    on: vi.fn().mockReturnValue({ id: 'ref' }),
    settings,
    settingsState: {
      effectiveValues: settings,
      inputValues: settings,
      validationMessages: {
        codeBlockLinkLanguages: '',
        datePropertyNames: '',
        isBacklinksModuleEnabled: '',
        isCodeBlockLinksModuleEnabled: '',
        isHeadingsModuleEnabled: '',
        isNamesModuleEnabled: '',
        isNonMarkdownModuleEnabled: '',
        isPropertiesModuleEnabled: '',
        isTitlesModuleEnabled: '',
        isUnlinkedMentionsModuleEnabled: '',
        markdownFileExtensions: '',
        pluginDataFolder: '',
        shouldAutomaticallyRefreshBacklinkPanels: '',
        shouldOfferTitlesInLinkSuggestions: '',
        shouldShowProgressBarOnLoad: '',
        titleNamePatterns: '',
        titlePropertyNames: ''
      }
    }
  });

  const plugin = strictProxy<Plugin>({
    app: {
      workspace: {
        on: vi.fn().mockReturnValue({ id: 'test' })
      }
    }
  });

  const tab = new PluginSettingsTab({
    plugin,
    pluginDataSync,
    pluginSettingsComponent
  });

  tab.containerEl = activeWindow.createDiv();

  const bindParams = new Map<string>();
  const propertyNames: string[] = [];
  type ModuleToggleChangeHandler = (isEnabledNow: boolean, wasEnabled: boolean) => Promisable<void>;
  const moduleToggleChangeHandlers = new Map<string, ModuleToggleChangeHandler | undefined>();

  vi.spyOn(tab, 'bind').mockImplementation((params) => {
    bindParams.set(params.propertyName, params);
    propertyNames.push(params.propertyName);
    if (params.onChanged) {
      moduleToggleChangeHandlers.set(params.propertyName, castTo<ModuleToggleChangeHandler | undefined>(params.onChanged));
    }
    return params.valueComponent;
  });

  const definitions = tab.getSettingDefinitions();
  for (const definition of definitions) {
    if ('render' in definition) {
      definition.render(new SettingEx(tab.containerEl), castTo<SettingGroup>(null));
    }
  }

  return {
    bindParams,
    containerEl: tab.containerEl,
    definitions,
    pluginDataSync,
    propertyNames,
    tab,
    triggerModuleToggleChange: async (propertyName: string): Promise<void> => {
      await moduleToggleChangeHandlers.get(propertyName)?.(false, true);
    }
  };
}

function createPluginDataSync(isSyncEnabled = false): PluginDataSync {
  return strictProxy<PluginDataSync>({
    isSyncEnabled,
    relocate: vi.fn().mockResolvedValue(undefined),
    setSyncEnabled: vi.fn().mockResolvedValue(undefined)
  });
}

describe('PluginSettingsTab', () => {
  it('should display a toggle setting per module plus the backlinks options, bound to the correct properties', () => {
    const harness = createHarness(true);

    expect(harness.definitions.map((definition) => 'name' in definition ? definition.name : '')).toStrictEqual([
      'Backlinks module',
      'Code block links module',
      'Code block languages',
      'External links module',
      'HTML module',
      'Headings module',
      'Link texts module',
      'Names module',
      'Properties module',
      'Date properties',
      'Default time zone',
      'Tags module',
      'Titles module',
      'Title properties',
      'Name patterns',
      'Offer titles in the [[ autocomplete',
      'Unlinked mentions module',
      'Should automatically refresh backlink panels',
      'Should show progress bar on load',
      'Non-Markdown module',
      'Markdown file extensions',
      'Sync between devices',
      'Plugin data folder'
    ]);
    expect(harness.propertyNames).toStrictEqual([
      'isBacklinksModuleEnabled',
      'isCodeBlockLinksModuleEnabled',
      'codeBlockLinkLanguages',
      'isExternalLinksModuleEnabled',
      'isHtmlModuleEnabled',
      'isHeadingsModuleEnabled',
      'isLinkTextsModuleEnabled',
      'isNamesModuleEnabled',
      'isPropertiesModuleEnabled',
      'datePropertyNames',
      'defaultTimeZone',
      'isTagsModuleEnabled',
      'isTitlesModuleEnabled',
      'titlePropertyNames',
      'titleNamePatterns',
      'shouldOfferTitlesInLinkSuggestions',
      'isUnlinkedMentionsModuleEnabled',
      'shouldAutomaticallyRefreshBacklinkPanels',
      'shouldShowProgressBarOnLoad',
      'isNonMarkdownModuleEnabled',
      'markdownFileExtensions',
      'pluginDataFolder'
    ]);
  });

  it('should show the options belonging to a module that is on', () => {
    const harness = createHarness(true, true, true);

    expect(harness.definitions.map((definition) => checkIsVisible(definition))).toStrictEqual([true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true]);
  });

  it('should hide the options belonging to a module that is off, leaving every module toggle visible', () => {
    const harness = createHarness(false);

    expect(harness.definitions.map((definition) => checkIsVisible(definition))).toStrictEqual([true, true, false, true, true, true, true, true, true, false, false, true, true, false, false, false, true, false, false, true, false, true, true]);
  });

  it('should hide the titles-in-autocomplete toggle until BOTH modules it needs are on', () => {
    const titlesOnly = createHarness(true, true, false);
    const namesOnly = createHarness(true, false, true);

    // It reads a title through the `Titles` module and puts it in the `Names` module's array, so
    // either one being off leaves it inert - and an inert toggle is worse than an absent one.
    expect(checkIsVisible(titlesOnly.definitions[15])).toBe(false);
    expect(checkIsVisible(namesOnly.definitions[15])).toBe(false);
    expect(checkIsVisible(createHarness(true, true, true).definitions[15])).toBe(true);
  });

  it('should re-render the tab when the backlinks module toggle changes, so the hidden rows follow it', async () => {
    const harness = createHarness(true);
    const refreshSpy = vi.spyOn(harness.tab, 'refresh').mockImplementation(() => undefined);

    await harness.triggerModuleToggleChange('isBacklinksModuleEnabled');

    expect(refreshSpy).toHaveBeenCalledOnce();
  });

  it('should re-render the tab when the code block links module toggle changes', async () => {
    const harness = createHarness(true);
    const refreshSpy = vi.spyOn(harness.tab, 'refresh').mockImplementation(() => undefined);

    await harness.triggerModuleToggleChange('isCodeBlockLinksModuleEnabled');

    expect(refreshSpy).toHaveBeenCalledOnce();
  });

  it('refreshes the extension setting when the non-Markdown module is toggled', async () => {
    const harness = createHarness(true);
    const refresh = vi.spyOn(harness.tab, 'refresh').mockImplementation(() => undefined);
    await harness.triggerModuleToggleChange('isNonMarkdownModuleEnabled');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('should re-render the tab when the names module toggle changes', async () => {
    const harness = createHarness(true);
    const refreshSpy = vi.spyOn(harness.tab, 'refresh').mockImplementation(() => undefined);

    await harness.triggerModuleToggleChange('isNamesModuleEnabled');

    expect(refreshSpy).toHaveBeenCalledOnce();
  });

  it('should re-render the tab when the properties module toggle changes', async () => {
    const harness = createHarness(true);
    const refreshSpy = vi.spyOn(harness.tab, 'refresh').mockImplementation(() => undefined);

    await harness.triggerModuleToggleChange('isPropertiesModuleEnabled');

    expect(refreshSpy).toHaveBeenCalledOnce();
  });

  it('should re-render the tab when the titles module toggle changes', async () => {
    const harness = createHarness(true);
    const refreshSpy = vi.spyOn(harness.tab, 'refresh').mockImplementation(() => undefined);

    await harness.triggerModuleToggleChange('isTitlesModuleEnabled');

    expect(refreshSpy).toHaveBeenCalledOnce();
  });

  it('should edit the name patterns as one comma-separated line per pattern', () => {
    const harness = createHarness(true, true);
    const converters = castTo<ValueConverters>(harness.bindParams.get('titleNamePatterns'));

    expect(converters.pluginSettingsToComponentValueConverter([['lastName', 'firstName'], ['firstName']])).toEqual(['lastName, firstName', 'firstName']);
    expect(converters.componentToPluginSettingsValueConverter([' lastName ,firstName', '', 'firstName'])).toEqual([['lastName', 'firstName'], ['firstName']]);
  });

  it('should keep the Move button disabled while this device does not sync', () => {
    const harness = createHarness(true);

    expect(findMoveButton(harness).disabled).toBe(true);
    expect(findMoveButton(createHarness(true, false, false, createPluginDataSync(true))).disabled).toBe(false);
  });

  it('should move the store to the folder the setting names, and re-render', async () => {
    const harness = createHarness(true, false, false, createPluginDataSync(true));
    const refresh = vi.spyOn(harness.tab, 'refresh').mockImplementation(() => undefined);

    findMoveButton(harness).click();

    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalledOnce();
    });
    expect(harness.pluginDataSync.relocate).toHaveBeenCalledWith('Sync/Data');
  });

  it('should turn sync on through the toggle, and re-render', async () => {
    const onChange = vi.spyOn(ToggleComponent.prototype, 'onChange');
    const harness = createHarness(true);
    const refresh = vi.spyOn(harness.tab, 'refresh').mockImplementation(() => undefined);

    // The sync toggle is the last toggle the tab renders.
    const handler = onChange.mock.calls.at(-1)?.[0];
    await handler?.(true);

    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalledOnce();
    });
    expect(harness.pluginDataSync.setSyncEnabled).toHaveBeenCalledWith(true);
  });
});

describe('PluginSettingsTab sync errors', () => {
  it('should report a failed switch or move in a notice, and still re-render', async () => {
    const onChange = vi.spyOn(ToggleComponent.prototype, 'onChange');
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const pluginDataSync = strictProxy<PluginDataSync>({
      isSyncEnabled: true,
      relocate: vi.fn().mockRejectedValue('not a folder'),
      setSyncEnabled: vi.fn().mockRejectedValue(new Error('offline'))
    });
    const harness = createHarness(true, false, false, pluginDataSync);
    const refresh = vi.spyOn(harness.tab, 'refresh').mockImplementation(() => undefined);

    await onChange.mock.calls.at(-1)?.[0]?.(false);
    findMoveButton(harness).click();

    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(2);
    });
    expect(notice.mock.calls.map(([message]) => message)).toEqual(['Sync between devices: offline', 'Plugin data folder: not a folder']);
  });
});

function findMoveButton(harness: Harness): HTMLButtonElement {
  const button = [...harness.containerEl.querySelectorAll('button')].find((element) => element.textContent === 'Move');
  if (!button) {
    throw new Error('No Move button rendered');
  }
  return button;
}
