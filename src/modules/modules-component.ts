import type { Component } from 'obsidian';
import type { ReadonlyPluginSettings } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';

import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

/**
 * One independently switchable module: how to build it, and which setting decides whether it runs.
 *
 * Every index this plugin maintains is a module, so that a user who wants one of them does not pay for
 * the others. The module is built lazily, by {@link createComponent}, because a module that is switched
 * off must cost nothing at all — not a constructed object, and not the listeners its constructor would
 * otherwise register.
 */
export interface ModuleDefinition {
  /**
   * Builds the component that IS the module. Called once per transition from off to on, so a module that
   * is switched off and on again gets a fresh component rather than a re-loaded one.
   *
   * @returns The module's component.
   */
  createComponent: () => Component;

  /**
   * Reads the module's own toggle out of the settings.
   *
   * @param settings - The current effective settings.
   * @returns Whether the module should be running.
   */
  getIsEnabled: (settings: ReadonlyPluginSettings<PluginSettings>) => boolean;

  /**
   * Identifies the module within this component. Never shown to the user.
   */
  readonly moduleId: string;
}

interface ModulesComponentConstructorParams {
  readonly moduleDefinitions: readonly ModuleDefinition[];
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Runs the modules the settings have switched on, and only those.
 *
 * A module is added as a child when its toggle goes on and removed when it goes off, so switching one
 * costs no reload: `removeChild` unloads the component, which takes its patches, its listeners and its
 * commands down with it.
 */
export class ModulesComponent extends ComponentEx {
  private readonly loadedModules = new Map<string, Component>();
  private readonly moduleDefinitions: readonly ModuleDefinition[];
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: ModulesComponentConstructorParams) {
    super();

    this.moduleDefinitions = params.moduleDefinitions;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  public override onload(): void {
    const eventRef = this.pluginSettingsComponent.on('saveSettings', () => {
      this.syncModules();
    });
    this.register(() => {
      this.pluginSettingsComponent.offref(eventRef);
    });
  }

  public override async onloadAsync(): Promise<void> {
    // Until the first read of `data.json` completes, `settings` still holds the DEFAULTS, so syncing
    // before it would start a module the user had switched off and stop it again a moment later.
    await this.pluginSettingsComponent.whenLoadedFromFile();
    this.syncModules();
  }

  private syncModules(): void {
    for (const moduleDefinition of this.moduleDefinitions) {
      const loadedModule = this.loadedModules.get(moduleDefinition.moduleId);
      const isEnabled = moduleDefinition.getIsEnabled(this.pluginSettingsComponent.settings);

      if (isEnabled && !loadedModule) {
        this.loadedModules.set(moduleDefinition.moduleId, this.addChild(moduleDefinition.createComponent()));
        continue;
      }

      // Running and wanted, or stopped and not wanted: nothing to change.
      if (isEnabled || !loadedModule) {
        continue;
      }

      this.loadedModules.delete(moduleDefinition.moduleId);
      this.removeChild(loadedModule);
    }
  }
}
