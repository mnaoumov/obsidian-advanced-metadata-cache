import type {
  Plugin,
  SettingDefinitionItem,
  SettingGroup
} from 'obsidian';
import type { PluginSettingsComponentBase } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';
import type { Promisable } from 'type-fest';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { SettingEx } from 'obsidian-dev-utils/obsidian/setting-ex';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettings } from './plugin-settings.ts';

import { PluginSettingsTab } from './plugin-settings-tab.ts';

interface Harness {
  readonly definitions: SettingDefinitionItem[];
  readonly propertyNames: string[];
  readonly tab: PluginSettingsTab;
  triggerModuleToggleChange: (propertyName: string) => Promise<void>;
}

type ModuleToggleChangeHandler = (isEnabledNow: boolean, wasEnabled: boolean) => Promisable<void>;

interface VisibleHolder {
  readonly visible?: (() => boolean) | boolean;
}

function checkIsVisible(definition: SettingDefinitionItem | undefined): boolean {
  const { visible } = castTo<VisibleHolder>(definition);
  return typeof visible === 'function' ? visible() : visible !== false;
}

function createHarness(isBacklinksModuleEnabled: boolean, isTitlesModuleEnabled = false, isNamesModuleEnabled = false): Harness {
  const settings = {
    isBacklinksModuleEnabled,
    isNamesModuleEnabled,
    isTitlesModuleEnabled,
    shouldAutomaticallyRefreshBacklinkPanels: false,
    shouldOfferTitlesInLinkSuggestions: false,
    shouldShowProgressBarOnLoad: true,
    titlePropertyNames: ['title']
  };

  const pluginSettingsComponent = strictProxy<PluginSettingsComponentBase<PluginSettings>>({
    on: vi.fn().mockReturnValue({ id: 'ref' }),
    settings,
    settingsState: {
      effectiveValues: settings,
      inputValues: settings,
      validationMessages: {
        isBacklinksModuleEnabled: '',
        isNamesModuleEnabled: '',
        isTitlesModuleEnabled: '',
        shouldAutomaticallyRefreshBacklinkPanels: '',
        shouldOfferTitlesInLinkSuggestions: '',
        shouldShowProgressBarOnLoad: '',
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

  const propertyNames: string[] = [];
  const moduleToggleChangeHandlers = new Map<string, ModuleToggleChangeHandler | undefined>();

  vi.spyOn(tab, 'bind').mockImplementation((params) => {
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
      'Names module',
      'Titles module',
      'Title properties',
      'Offer titles in the [[ autocomplete',
      'Should automatically refresh backlink panels',
      'Should show progress bar on load'
    ]);
    expect(harness.propertyNames).toStrictEqual([
      'isBacklinksModuleEnabled',
      'isNamesModuleEnabled',
      'isTitlesModuleEnabled',
      'titlePropertyNames',
      'shouldOfferTitlesInLinkSuggestions',
      'shouldAutomaticallyRefreshBacklinkPanels',
      'shouldShowProgressBarOnLoad'
    ]);
  });

  it('should show the options belonging to a module that is on', () => {
    const harness = createHarness(true, true, true);

    expect(harness.definitions.map((definition) => checkIsVisible(definition))).toStrictEqual([true, true, true, true, true, true, true]);
  });

  it('should hide the options belonging to a module that is off, leaving every module toggle visible', () => {
    const harness = createHarness(false);

    expect(harness.definitions.map((definition) => checkIsVisible(definition))).toStrictEqual([true, true, true, false, false, false, false]);
  });

  it('should hide the titles-in-autocomplete toggle until BOTH modules it needs are on', () => {
    const titlesOnly = createHarness(true, true, false);
    const namesOnly = createHarness(true, false, true);

    // It reads a title through the `Titles` module and puts it in the `Names` module's array, so
    // either one being off leaves it inert - and an inert toggle is worse than an absent one.
    expect(checkIsVisible(titlesOnly.definitions[4])).toBe(false);
    expect(checkIsVisible(namesOnly.definitions[4])).toBe(false);
    expect(checkIsVisible(createHarness(true, true, true).definitions[4])).toBe(true);
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

  it('should re-render the tab when the titles module toggle changes', async () => {
    const harness = createHarness(true);
    const refreshSpy = vi.spyOn(harness.tab, 'refresh').mockImplementation(() => undefined);

    await harness.triggerModuleToggleChange('isTitlesModuleEnabled');

    expect(refreshSpy).toHaveBeenCalledOnce();
  });
});
