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
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettings } from './plugin-settings.ts';

import { PluginSettingsTab } from './plugin-settings-tab.ts';

interface Harness {
  readonly bindParams: Map<string, unknown>;
  readonly definitions: SettingDefinitionItem[];
  readonly propertyNames: string[];
  readonly tab: PluginSettingsTab;
  readonly triggerModuleToggleChange: (propertyName: string) => Promise<void>;
}

type ModuleToggleChangeHandler = (isEnabledNow: boolean, wasEnabled: boolean) => Promisable<void>;

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
  isPropertiesModuleEnabled = isBacklinksModuleEnabled
): Harness {
  const settings = {
    datePropertyNames: ['date', '*Date'],
    isBacklinksModuleEnabled,
    isHeadingsModuleEnabled: false,
    isNamesModuleEnabled,
    isPropertiesModuleEnabled,
    isTitlesModuleEnabled,
    isUnlinkedMentionsModuleEnabled: false,
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
        datePropertyNames: '',
        isBacklinksModuleEnabled: '',
        isHeadingsModuleEnabled: '',
        isNamesModuleEnabled: '',
        isPropertiesModuleEnabled: '',
        isTitlesModuleEnabled: '',
        isUnlinkedMentionsModuleEnabled: '',
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
    pluginSettingsComponent
  });

  tab.containerEl = activeWindow.createDiv();

  const bindParams = new Map<string>();
  const propertyNames: string[] = [];
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
    definitions,
    propertyNames,
    tab,
    triggerModuleToggleChange: async (propertyName: string): Promise<void> => {
      await moduleToggleChangeHandlers.get(propertyName)?.(false, true);
    }
  };
}

describe('PluginSettingsTab', () => {
  it('should display a toggle setting per module plus the backlinks options, bound to the correct properties', () => {
    const harness = createHarness(true);

    expect(harness.definitions.map((definition) => 'name' in definition ? definition.name : '')).toStrictEqual([
      'Backlinks module',
      'Headings module',
      'Link texts module',
      'Names module',
      'Properties module',
      'Date properties',
      'Default time zone',
      'Titles module',
      'Title properties',
      'Name patterns',
      'Offer titles in the [[ autocomplete',
      'Unlinked mentions module',
      'Should automatically refresh backlink panels',
      'Should show progress bar on load'
    ]);
    expect(harness.propertyNames).toStrictEqual([
      'isBacklinksModuleEnabled',
      'isHeadingsModuleEnabled',
      'isLinkTextsModuleEnabled',
      'isNamesModuleEnabled',
      'isPropertiesModuleEnabled',
      'datePropertyNames',
      'defaultTimeZone',
      'isTitlesModuleEnabled',
      'titlePropertyNames',
      'titleNamePatterns',
      'shouldOfferTitlesInLinkSuggestions',
      'isUnlinkedMentionsModuleEnabled',
      'shouldAutomaticallyRefreshBacklinkPanels',
      'shouldShowProgressBarOnLoad'
    ]);
  });

  it('should show the options belonging to a module that is on', () => {
    const harness = createHarness(true, true, true);

    expect(harness.definitions.map((definition) => checkIsVisible(definition))).toStrictEqual([true, true, true, true, true, true, true, true, true, true, true, true, true, true]);
  });

  it('should hide the options belonging to a module that is off, leaving every module toggle visible', () => {
    const harness = createHarness(false);

    expect(harness.definitions.map((definition) => checkIsVisible(definition))).toStrictEqual([true, true, true, true, true, false, false, true, false, false, false, true, false, false]);
  });

  it('should hide the titles-in-autocomplete toggle until BOTH modules it needs are on', () => {
    const titlesOnly = createHarness(true, true, false);
    const namesOnly = createHarness(true, false, true);

    // It reads a title through the `Titles` module and puts it in the `Names` module's array, so
    // either one being off leaves it inert - and an inert toggle is worse than an absent one.
    expect(checkIsVisible(titlesOnly.definitions[10])).toBe(false);
    expect(checkIsVisible(namesOnly.definitions[10])).toBe(false);
    expect(checkIsVisible(createHarness(true, true, true).definitions[10])).toBe(true);
  });

  it('should re-render the tab when the backlinks module toggle changes, so the hidden rows follow it', async () => {
    const harness = createHarness(true);
    const refreshSpy = vi.spyOn(harness.tab, 'refresh').mockImplementation(() => undefined);

    await harness.triggerModuleToggleChange('isBacklinksModuleEnabled');

    expect(refreshSpy).toHaveBeenCalledOnce();
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
});
