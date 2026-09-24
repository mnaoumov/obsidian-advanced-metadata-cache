/**
 * @file
 *
 * The dialog a settings migration goes through.
 *
 * Another plugin proposes title properties it used to own; this dialog puts them next to the list this plugin
 * holds now and lets the user approve, edit or decline them. Nothing is written until the user presses OK.
 */

import type { App } from 'obsidian';
import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  ButtonComponent,
  Setting,
  TextAreaComponent,
  ToggleComponent
} from 'obsidian';
import {
  ModalBase,
  showModal
} from 'obsidian-dev-utils/obsidian/modals/modal';

import { parseTitlePropertyNames } from './settings-migration.ts';

/**
 * What the user approved in the dialog.
 */
export interface ApprovedSettingsMigration {
  /**
   * Whether to switch the `Titles` module on. Only ever `true` when it was off and the user left the offer on.
   */
  readonly shouldEnableTitlesModule: boolean;

  /**
   * The title properties to hold from now on — the merged list, as the user left it.
   */
  readonly titlePropertyNames: string[];
}

/**
 * Parameters for {@link showSettingsMigrationModal}.
 */
export interface ShowSettingsMigrationModalParams {
  /**
   * An Obsidian app instance.
   */
  readonly app: App;

  /**
   * The title properties this plugin holds now.
   */
  readonly currentTitlePropertyNames: readonly string[];

  /**
   * Whether the `Titles` module is on. While it is off the dialog offers to switch it on.
   */
  readonly isTitlesModuleEnabled: boolean;

  /**
   * The list the dialog suggests: the current one with the proposed names added.
   */
  readonly mergedTitlePropertyNames: readonly string[];

  /**
   * The title properties the other plugin proposes.
   */
  readonly proposedTitlePropertyNames: readonly string[];

  /**
   * The display name of the plugin making the proposal.
   */
  readonly sourcePluginName: string;
}

interface SettingsMigrationModalConstructorParams extends ShowSettingsMigrationModalParams {
  readonly promiseResolve: PromiseResolve<ApprovedSettingsMigration | null>;
}

class SettingsMigrationModal extends ModalBase<ApprovedSettingsMigration | null> {
  private approvedSettingsMigration: ApprovedSettingsMigration | null = null;
  private readonly currentTitlePropertyNames: readonly string[];
  private readonly isTitlesModuleEnabled: boolean;
  private readonly proposedTitlePropertyNames: readonly string[];
  private shouldEnableTitlesModule: boolean;
  private readonly sourcePluginName: string;
  private titlePropertyNames: string[];

  public constructor(params: SettingsMigrationModalConstructorParams) {
    super(params);
    this.currentTitlePropertyNames = params.currentTitlePropertyNames;
    this.isTitlesModuleEnabled = params.isTitlesModuleEnabled;
    this.proposedTitlePropertyNames = params.proposedTitlePropertyNames;
    this.sourcePluginName = params.sourcePluginName;
    this.titlePropertyNames = [...params.mergedTitlePropertyNames];
    this.shouldEnableTitlesModule = !params.isTitlesModuleEnabled;
  }

  public override onClose(): void {
    this.promiseResolve(this.approvedSettingsMigration);
  }

  public override onOpen(): void {
    this.titleEl.setText(`Title properties proposed by ${this.sourcePluginName}`);

    this.contentEl.createEl('p', {
      text: `${this.sourcePluginName} no longer keeps a title property of its own, and reads this plugin's list instead. It proposes the one it held, so notes it used to show under that property keep showing under it.`
    });
    this.contentEl.createEl('p', {
      text: `Proposed: ${formatTitlePropertyNames(this.proposedTitlePropertyNames)}. Currently: ${formatTitlePropertyNames(this.currentTitlePropertyNames)}. The proposed names are added to the current list below; edit it if you like. Nothing is written until you press OK.`
    });

    const titlePropertiesSetting = new Setting(this.contentEl);
    titlePropertiesSetting.setName('Title properties');
    titlePropertiesSetting.setDesc('One per line.');
    const textAreaComponent = new TextAreaComponent(titlePropertiesSetting.controlEl);
    textAreaComponent.setValue(this.titlePropertyNames.join('\n'));
    textAreaComponent.onChange((value) => {
      this.titlePropertyNames = parseTitlePropertyNames(value.split('\n'));
    });

    if (!this.isTitlesModuleEnabled) {
      const titlesModuleSetting = new Setting(this.contentEl);
      titlesModuleSetting.setName('Titles module');
      titlesModuleSetting.setDesc('Turn it on as well. It is off, and while it is off the title properties are not read at all.');
      const toggleComponent = new ToggleComponent(titlesModuleSetting.controlEl);
      toggleComponent.setValue(this.shouldEnableTitlesModule);
      toggleComponent.onChange((value) => {
        this.shouldEnableTitlesModule = value;
      });
    }

    const buttonsEl = this.contentEl.createDiv();

    const okButton = new ButtonComponent(buttonsEl);
    okButton.setButtonText('OK');
    okButton.setCta();
    okButton.onClick(() => {
      this.approvedSettingsMigration = {
        shouldEnableTitlesModule: this.shouldEnableTitlesModule,
        titlePropertyNames: [...this.titlePropertyNames]
      };
      this.close();
    });

    const cancelButton = new ButtonComponent(buttonsEl);
    cancelButton.setButtonText('Cancel');
    cancelButton.onClick(this.close.bind(this));
  }
}

/**
 * Shows the migration dialog and waits for the user to settle it.
 *
 * @param params - The proposal to review.
 * @returns What the user approved, or `null` when they cancelled.
 */
export async function showSettingsMigrationModal(params: ShowSettingsMigrationModalParams): Promise<ApprovedSettingsMigration | null> {
  return await showModal<ApprovedSettingsMigration | null>((promiseResolve) =>
    new SettingsMigrationModal({
      ...params,
      promiseResolve
    })
  );
}

function formatTitlePropertyNames(titlePropertyNames: readonly string[]): string {
  return titlePropertyNames.length === 0 ? '(none)' : titlePropertyNames.join(', ');
}
