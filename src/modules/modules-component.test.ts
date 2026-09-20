import type { AsyncEventRef } from 'obsidian-dev-utils/async-events';

import { Component } from 'obsidian';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { ModuleDefinition } from './modules-component.ts';

import { PluginSettings } from '../plugin-settings.ts';
import { ModulesComponent } from './modules-component.ts';

interface Harness {
  readonly component: ModulesComponent;
  readonly createdModuleComponents: TestModuleComponent[];
  readonly offref: ReturnType<typeof vi.fn>;
  readonly settings: PluginSettings;
  triggerSaveSettings(): void;
}

class TestModuleComponent extends Component {
  public isLoaded = false;

  public override onload(): void {
    this.isLoaded = true;
  }

  public override onunload(): void {
    this.isLoaded = false;
  }
}

function createHarness(): Harness {
  const settings = new PluginSettings();
  const createdModuleComponents: TestModuleComponent[] = [];
  const eventRef = strictProxy<AsyncEventRef>({});
  const offref = vi.fn();
  let saveSettingsCallback: (() => void) | undefined;

  const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
    offref,
    on: vi.fn((_name: string, callback: () => void) => {
      saveSettingsCallback = callback;
      return eventRef;
    }),
    settings,
    whenLoadedFromFile: vi.fn().mockResolvedValue(undefined)
  });

  const moduleDefinition: ModuleDefinition = {
    createComponent: () => {
      const moduleComponent = new TestModuleComponent();
      createdModuleComponents.push(moduleComponent);
      return moduleComponent;
    },
    getIsEnabled: (currentSettings) => currentSettings.isBacklinksModuleEnabled,
    moduleId: 'backlinks'
  };

  const component = new ModulesComponent({
    moduleDefinitions: [moduleDefinition],
    pluginSettingsComponent
  });

  return {
    component,
    createdModuleComponents,
    offref,
    settings,
    triggerSaveSettings: (): void => {
      saveSettingsCallback?.();
    }
  };
}

describe('ModulesComponent', () => {
  it('should load a module whose setting is on', async () => {
    const harness = createHarness();
    await harness.component.loadWithPromises();

    expect(harness.createdModuleComponents).toHaveLength(1);
    expect(harness.createdModuleComponents[0]?.isLoaded).toBe(true);
  });

  it('should not load a module whose setting is off', async () => {
    const harness = createHarness();
    harness.settings.isBacklinksModuleEnabled = false;
    await harness.component.loadWithPromises();

    expect(harness.createdModuleComponents).toHaveLength(0);
  });

  it('should load a module when its setting is switched on', async () => {
    const harness = createHarness();
    harness.settings.isBacklinksModuleEnabled = false;
    await harness.component.loadWithPromises();

    harness.settings.isBacklinksModuleEnabled = true;
    harness.triggerSaveSettings();

    expect(harness.createdModuleComponents).toHaveLength(1);
    expect(harness.createdModuleComponents[0]?.isLoaded).toBe(true);
  });

  it('should unload a module when its setting is switched off', async () => {
    const harness = createHarness();
    await harness.component.loadWithPromises();

    harness.settings.isBacklinksModuleEnabled = false;
    harness.triggerSaveSettings();

    expect(harness.createdModuleComponents[0]?.isLoaded).toBe(false);
  });

  it('should leave an unchanged module alone when the settings are saved', async () => {
    const harness = createHarness();
    await harness.component.loadWithPromises();

    harness.triggerSaveSettings();

    expect(harness.createdModuleComponents).toHaveLength(1);
    expect(harness.createdModuleComponents[0]?.isLoaded).toBe(true);
  });

  it('should build a fresh component when a module is switched off and on again', async () => {
    const harness = createHarness();
    await harness.component.loadWithPromises();

    harness.settings.isBacklinksModuleEnabled = false;
    harness.triggerSaveSettings();
    harness.settings.isBacklinksModuleEnabled = true;
    harness.triggerSaveSettings();

    expect(harness.createdModuleComponents).toHaveLength(2);
    expect(harness.createdModuleComponents[0]?.isLoaded).toBe(false);
    expect(harness.createdModuleComponents[1]?.isLoaded).toBe(true);
  });

  it('should stop listening for settings changes when unloaded', async () => {
    const harness = createHarness();
    await harness.component.loadWithPromises();
    harness.component.unload();

    expect(harness.offref).toHaveBeenCalledOnce();
  });
});
