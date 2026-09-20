import type { App } from 'obsidian';
import type { CommandHandlerComponent } from 'obsidian-dev-utils/obsidian/command-handlers/command-handler-component';
import type { AbortSignalComponent } from 'obsidian-dev-utils/obsidian/components/abort-signal-component';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';

import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';

import { BacklinkCacheComponent } from './backlink-cache-component.ts';
import { RefreshBacklinkPanelsCommandHandler } from './command-handlers/refresh-backlink-panels-command-handler.ts';

interface BacklinksModuleComponentConstructorParams {
  readonly abortSignalComponent: AbortSignalComponent;
  readonly app: App;
  readonly commandHandlerComponent: CommandHandlerComponent;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * The `backlinks` module: the backlink index and everything that only makes sense while it is running.
 *
 * The command is registered here rather than by the plugin, with this component as its lifetime owner, so
 * that switching the module off takes `Refresh backlink panels` out of the palette with it — a command
 * left behind would call into a torn-down cache.
 */
export class BacklinksModuleComponent extends ComponentEx {
  private readonly abortSignalComponent: AbortSignalComponent;
  private readonly app: App;
  private readonly commandHandlerComponent: CommandHandlerComponent;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: BacklinksModuleComponentConstructorParams) {
    super();

    this.abortSignalComponent = params.abortSignalComponent;
    this.app = params.app;
    this.commandHandlerComponent = params.commandHandlerComponent;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  public override async onloadAsync(): Promise<void> {
    const backlinkCacheComponent = this.addChild(
      new BacklinkCacheComponent({
        abortSignalComponent: this.abortSignalComponent,
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent: this.pluginSettingsComponent
      })
    );

    await this.commandHandlerComponent.registerCommandHandlers(() => [
      new RefreshBacklinkPanelsCommandHandler(backlinkCacheComponent)
    ], { lifetimeOwner: this });
  }
}
