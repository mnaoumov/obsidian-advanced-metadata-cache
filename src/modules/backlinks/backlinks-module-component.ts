import type { CommandHandlerComponent } from '@mnaoumov/obsidian-lib/command-handlers/command-handler-component';
import type { AbortSignalComponent } from '@mnaoumov/obsidian-lib/components/abort-signal-component';
import type { ConsoleDebugComponent } from '@mnaoumov/obsidian-lib/components/console-debug-component';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { App } from 'obsidian';

import { ComponentEx } from '@mnaoumov/obsidian-lib/components/component-ex';

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
  /**
   * The cache, built with the module rather than when it loads, so the published API finds it from the
   * moment the module exists. It answers like the core method until its own patch is installed.
   */
  public readonly backlinkCacheComponent: BacklinkCacheComponent;

  private readonly commandHandlerComponent: CommandHandlerComponent;

  public constructor(params: BacklinksModuleComponentConstructorParams) {
    super();

    this.commandHandlerComponent = params.commandHandlerComponent;
    this.backlinkCacheComponent = new BacklinkCacheComponent({
      abortSignalComponent: params.abortSignalComponent,
      app: params.app,
      consoleDebugComponent: params.consoleDebugComponent,
      pluginNoticeComponent: params.pluginNoticeComponent,
      pluginSettingsComponent: params.pluginSettingsComponent
    });
  }

  public override async onloadAsync(): Promise<void> {
    const backlinkCacheComponent = this.addChild(this.backlinkCacheComponent);

    await this.commandHandlerComponent.registerCommandHandlers(() => [
      new RefreshBacklinkPanelsCommandHandler(backlinkCacheComponent)
    ], { lifetimeOwner: this });
  }
}
