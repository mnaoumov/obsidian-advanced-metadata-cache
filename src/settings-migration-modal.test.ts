// @vitest-environment jsdom

import type { App as AppOriginal } from 'obsidian';

import {
  ButtonComponent,
  TextAreaComponent,
  ToggleComponent
} from 'obsidian';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ShowSettingsMigrationModalParams } from './settings-migration-modal.ts';

import { showSettingsMigrationModal } from './settings-migration-modal.ts';

/*
 * The modal's components keep their handlers on the component instance rather than on the DOM node, so a
 * `click()` on the rendered element would do nothing. The handlers are captured as they are registered,
 * which is what lets a test press OK, edit the list, or flip the module toggle the way a user does.
 */

let app: AppOriginal;
let buttonHandlers: Map<ButtonComponent, (mouseEvent: MouseEvent) => unknown>;
let textAreaHandlers: Map<TextAreaComponent, (value: string) => void>;
let textAreaValues: string[];
let toggleHandlers: Map<ToggleComponent, (isEnabled: boolean) => void>;

beforeEach(() => {
  app = App.createConfigured__().asOriginalType__();
  buttonHandlers = new Map<ButtonComponent, (mouseEvent: MouseEvent) => unknown>();
  textAreaHandlers = new Map<TextAreaComponent, (value: string) => void>();
  textAreaValues = [];
  toggleHandlers = new Map<ToggleComponent, (isEnabled: boolean) => void>();

  vi.spyOn(ButtonComponent.prototype, 'onClick').mockImplementation(function onClickMock(this: ButtonComponent, callback: (mouseEvent: MouseEvent) => unknown): ButtonComponent {
    buttonHandlers.set(this, callback);
    return this;
  });

  vi.spyOn(TextAreaComponent.prototype, 'onChange').mockImplementation(
    function onChangeMock(this: TextAreaComponent, callback: (value: string) => void): TextAreaComponent {
      textAreaHandlers.set(this, callback);
      return this;
    }
  );

  vi.spyOn(TextAreaComponent.prototype, 'setValue').mockImplementation(function setValueMock(this: TextAreaComponent, value: string): TextAreaComponent {
    textAreaValues.push(value);
    return this;
  });

  vi.spyOn(ToggleComponent.prototype, 'onChange').mockImplementation(
    function onChangeMock(this: ToggleComponent, callback: (isEnabled: boolean) => void): ToggleComponent {
      toggleHandlers.set(this, callback);
      return this;
    }
  );
});

function createParams(overrides: Partial<ShowSettingsMigrationModalParams> = {}): ShowSettingsMigrationModalParams {
  return {
    app,
    currentTitlePropertyNames: ['title'],
    isTitlesModuleEnabled: true,
    mergedTitlePropertyNames: ['title', 'subtitle'],
    proposedTitlePropertyNames: ['subtitle'],
    sourcePluginName: 'Alias Quick Switcher',
    ...overrides
  };
}

function pressButton(buttonText: string): void {
  for (const [buttonComponent, handler] of buttonHandlers) {
    if (buttonComponent.buttonEl.textContent === buttonText) {
      handler(castTo<MouseEvent>({}));
      return;
    }
  }

  throw new Error(`The dialog has no "${buttonText}" button`);
}

describe('showSettingsMigrationModal', () => {
  it('should suggest the merged list, one name per line, and apply it as it stands on OK', async () => {
    const resultPromise = showSettingsMigrationModal(createParams());

    expect(textAreaValues).toEqual(['title\nsubtitle']);
    expect(toggleHandlers.size).toBe(0);

    pressButton('OK');

    expect(await resultPromise).toEqual({
      shouldEnableTitlesModule: false,
      titlePropertyNames: ['title', 'subtitle']
    });
  });

  it('should state what is proposed and what is held now, naming an empty list as none', async () => {
    const createElSpy = vi.spyOn(HTMLElement.prototype, 'createEl');
    const resultPromise = showSettingsMigrationModal(createParams({ currentTitlePropertyNames: [] }));

    const texts = createElSpy.mock.calls.map(([, options]) => (typeof options === 'object' ? options.text : undefined));
    expect(texts).toContainEqual(expect.stringContaining('Proposed: subtitle. Currently: (none).'));

    pressButton('Cancel');
    await resultPromise;
  });

  it('should write nothing when the user cancels', async () => {
    const resultPromise = showSettingsMigrationModal(createParams());

    pressButton('Cancel');

    expect(await resultPromise).toBeNull();
  });

  it('should carry the edited list into the approval, trimmed and without blank lines', async () => {
    const resultPromise = showSettingsMigrationModal(createParams());

    for (const handler of textAreaHandlers.values()) {
      handler(' subtitle \n\n heading\n');
    }

    pressButton('OK');

    const result = await resultPromise;
    expect(result?.titlePropertyNames).toEqual(['subtitle', 'heading']);
  });

  it('should offer to switch the module on while it is off, defaulting to yes', async () => {
    const resultPromise = showSettingsMigrationModal(createParams({ isTitlesModuleEnabled: false }));

    expect(toggleHandlers.size).toBe(1);

    pressButton('OK');

    const result = await resultPromise;
    expect(result?.shouldEnableTitlesModule).toBe(true);
  });

  it('should leave the module off when the user turns the offer down', async () => {
    const resultPromise = showSettingsMigrationModal(createParams({ isTitlesModuleEnabled: false }));

    for (const handler of toggleHandlers.values()) {
      handler(false);
    }

    pressButton('OK');

    const result = await resultPromise;
    expect(result?.shouldEnableTitlesModule).toBe(false);
  });
});
