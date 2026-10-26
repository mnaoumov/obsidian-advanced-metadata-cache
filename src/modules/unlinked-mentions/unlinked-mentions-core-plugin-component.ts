import type { BacklinkComponent } from '@obsidian-typings/obsidian-public-latest/implementations';
import type {
  App,
  Component
} from 'obsidian';

import type { UnlinkedMentionsComponent } from './unlinked-mentions-component.ts';

import { BacklinksCorePluginComponent } from '../backlinks/backlink-core-plugin.ts';
import { BacklinkComponentRecomputeUnlinkedPatchComponent } from './backlink-component-recompute-unlinked-patch-component.ts';

interface UnlinkedMentionsCorePluginComponentConstructorParams {
  readonly app: App;
  readonly unlinkedMentionsComponent: UnlinkedMentionsComponent;
}

/**
 * Installs the `Unlinked mentions` patch on the Backlinks pane, at the same moments the `backlinks` module installs
 * its own: at load, when the core plugin is enabled, and when a pane first appears. The two modules are switched on
 * independently, so each installs its own patch, of its own method.
 */
export class UnlinkedMentionsCorePluginComponent extends BacklinksCorePluginComponent {
  private readonly unlinkedMentionsComponent: UnlinkedMentionsComponent;

  public constructor(params: UnlinkedMentionsCorePluginComponentConstructorParams) {
    super(params.app);
    this.unlinkedMentionsComponent = params.unlinkedMentionsComponent;
  }

  protected override createPanePatchComponent(backlinkComponent: BacklinkComponent): Component {
    return new BacklinkComponentRecomputeUnlinkedPatchComponent({
      backlinkComponent,
      unlinkedMentionsComponent: this.unlinkedMentionsComponent
    });
  }

  /**
   * Nothing to redo: a section filled before the patch was in was filled by Obsidian's own scan, which lists the same
   * mentions, only more slowly.
   */
  protected override recomputeLatePatchedBacklinkComponent(): void {
    // Deliberately empty.
  }
}
