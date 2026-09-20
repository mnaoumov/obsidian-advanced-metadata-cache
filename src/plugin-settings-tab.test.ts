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
  triggerModuleToggleChange(): Promise<void>;
}

type ModuleToggleChangeHandler = (isEnabledNow: boolean, wasEnabled: boolean) => Promisable<void>;

interface VisibleHolder {
  readonly visible?: (() => boolean) | boolean;
}

function checkIsVisible(definition: SettingDefinitionItem | undefined): boolean {
  const { visible } = castTo<VisibleHolder>(definition);
  return typeof visible === 'function' ? visible() : visible !== false;
}

function createHarness(isBacklinksModuleEnabled: boolean): Harness {
  const settings = {
    isBacklinksModuleEnabled,
    shouldAutomaticallyRefreshBacklinkPanels: false,
    shouldShowProgressBarOnLoad: true
  };

  const pluginSettingsComponent = strictProxy<PluginSettingsComponentBase<PluginSettings>>({
    on: vi.fn().mockReturnValue({ id: 'ref' }),
    settings,
    settingsState: {
      effectiveValues: settings,
      inputValues: settings,
      validationMessages: {
        isBacklinksModuleEnabled: '',
        shouldAutomaticallyRefreshBacklinkPanels: '',
        shouldShowProgressBarOnLoad: ''
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
  let moduleToggleChangeHandler: ModuleToggleChangeHandler | undefined;

  vi.spyOn(tab, 'bind').mockImplementation((params) => {
    propertyNames.push(params.propertyName);
    if (params.propertyName === 'isBacklinksModuleEnabled') {
      moduleToggleChangeHandler = castTo<ModuleToggleChangeHandler | undefined>(params.onChanged);
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
    triggerModuleToggleChange: async (): Promise<void> => {
      await moduleToggleChangeHandler?.(false, true);
    }
  };
}

describe('PluginSettingsTab', () => {
  it('should display three toggle settings bound to the correct properties', () => {
    const harness = createHarness(true);

    expect(harness.definitions.map((definition) => 'name' in definition ? definition.name : '')).toStrictEqual([
      'Backlinks module',
      'Should automatically refresh backlink panels',
      'Should show progress bar on load'
    ]);
    expect(harness.propertyNames).toStrictEqual([
      'isBacklinksModuleEnabled',
      'shouldAutomaticallyRefreshBacklinkPanels',
      'shouldShowProgressBarOnLoad'
    ]);
  });

  it('should show the backlinks settings while the module is on', () => {
    const harness = createHarness(true);

    expect(harness.definitions.map((definition) => checkIsVisible(definition))).toStrictEqual([true, true, true]);
  });

  it('should hide the backlinks settings while the module is off', () => {
    const harness = createHarness(false);

    expect(harness.definitions.map((definition) => checkIsVisible(definition))).toStrictEqual([true, false, false]);
  });

  it('should re-render the tab when the module toggle changes, so the hidden rows follow it', async () => {
    const harness = createHarness(true);
    const refreshSpy = vi.spyOn(harness.tab, 'refresh').mockImplementation(() => undefined);

    await harness.triggerModuleToggleChange();

    expect(refreshSpy).toHaveBeenCalledOnce();
  });
});
