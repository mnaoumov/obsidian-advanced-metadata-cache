import type { App } from 'obsidian';
import type { DisposableEx } from 'obsidian-dev-utils/disposable';
import type { CommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/command-handler';
import type { CommandHandlerComponent } from 'obsidian-dev-utils/obsidian/command-handlers/command-handler-component';
import type { AbortSignalComponent } from 'obsidian-dev-utils/obsidian/components/abort-signal-component';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { Component } from 'obsidian';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';

const hoisted = vi.hoisted(() => ({
  backlinkCacheComponentConstructor: vi.fn()
}));

// Extends the real obsidian-test-mocks Component so the real addChild lifecycle can load it.
vi.mock('./backlink-cache-component.ts', () => ({
  BacklinkCacheComponent: class extends Component {
    public constructor(params: unknown) {
      super();
      hoisted.backlinkCacheComponentConstructor(params);
    }
  }
}));

/* eslint-disable import-x/first, import-x/imports-first -- vi.mock must precede imports. */
import { BacklinksModuleComponent } from './backlinks-module-component.ts';
import { RefreshBacklinkPanelsCommandHandler } from './command-handlers/refresh-backlink-panels-command-handler.ts';
/* eslint-enable import-x/first, import-x/imports-first -- End of the mocked imports. */

interface Harness {
  readonly component: BacklinksModuleComponent;
  readonly registerCommandHandlers: ReturnType<typeof vi.fn>;
}

interface RegisterCommandHandlersOptionsHolder {
  readonly lifetimeOwner?: unknown;
}

function createHarness(): Harness {
  const registerCommandHandlers = vi.fn().mockResolvedValue(strictProxy<DisposableEx>({}));

  const component = new BacklinksModuleComponent({
    abortSignalComponent: strictProxy<AbortSignalComponent>({}),
    app: strictProxy<App>({}),
    commandHandlerComponent: strictProxy<CommandHandlerComponent>({ registerCommandHandlers }),
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({}),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({}),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({})
  });

  return { component, registerCommandHandlers };
}

describe('BacklinksModuleComponent', () => {
  it('should build the backlink cache when loaded', async () => {
    const harness = createHarness();
    await harness.component.loadWithPromises();

    expect(hoisted.backlinkCacheComponentConstructor).toHaveBeenCalledOnce();
  });

  it('should register the refresh backlink panels command handler', async () => {
    const harness = createHarness();
    await harness.component.loadWithPromises();

    expect(harness.registerCommandHandlers).toHaveBeenCalledOnce();
    const commandHandlerFactory = harness.registerCommandHandlers.mock.calls[0]?.[0] as () => CommandHandler[];
    expect(commandHandlerFactory()[0]).toBeInstanceOf(RefreshBacklinkPanelsCommandHandler);
  });

  it('should own the command lifetime, so switching the module off removes it', async () => {
    const harness = createHarness();
    await harness.component.loadWithPromises();

    const options = harness.registerCommandHandlers.mock.calls[0]?.[1] as RegisterCommandHandlersOptionsHolder;
    expect(options.lifetimeOwner).toBe(harness.component);
  });
});
