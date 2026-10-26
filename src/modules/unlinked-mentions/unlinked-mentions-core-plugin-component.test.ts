import type { BacklinkComponent } from '@obsidian-typings/obsidian-public-latest/implementations';
import type {
  App,
  Component
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { Component as ComponentClass } from 'obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { UnlinkedMentionsComponent } from './unlinked-mentions-component.ts';

const hoisted = vi.hoisted(() => ({
  patchComponentConstructor: vi.fn()
}));

vi.mock('./backlink-component-recompute-unlinked-patch-component.ts', () => ({
  BacklinkComponentRecomputeUnlinkedPatchComponent: class extends ComponentClass {
    public constructor(params: unknown) {
      super();
      hoisted.patchComponentConstructor(params);
    }
  }
}));

/* eslint-disable import-x/first, import-x/imports-first -- vi.mock must precede imports. */
import { UnlinkedMentionsCorePluginComponent } from './unlinked-mentions-core-plugin-component.ts';
/* eslint-enable import-x/first, import-x/imports-first -- End of the mocked imports. */

interface UnlinkedMentionsCorePluginComponentInternals {
  createPanePatchComponent: (backlinkComponent: BacklinkComponent) => Component;
  recomputeLatePatchedBacklinkComponent: (backlinkComponent: BacklinkComponent) => void;
}

describe('UnlinkedMentionsCorePluginComponent', () => {
  it('should install the unlinked mentions patch, handing it the module', () => {
    const unlinkedMentionsComponent = castTo<UnlinkedMentionsComponent>({});
    const backlinkComponent = castTo<BacklinkComponent>({});
    const component = new UnlinkedMentionsCorePluginComponent({ app: castTo<App>({}), unlinkedMentionsComponent });

    internals(component).createPanePatchComponent(backlinkComponent);

    expect(hoisted.patchComponentConstructor).toHaveBeenCalledWith({ backlinkComponent, unlinkedMentionsComponent });
  });

  it('should leave a section Obsidian already filled alone when the patch arrives late', () => {
    const recomputeUnlinked = vi.fn();
    const component = new UnlinkedMentionsCorePluginComponent({ app: castTo<App>({}), unlinkedMentionsComponent: castTo<UnlinkedMentionsComponent>({}) });

    internals(component).recomputeLatePatchedBacklinkComponent(castTo<BacklinkComponent>({ recomputeUnlinked }));

    expect(recomputeUnlinked).not.toHaveBeenCalled();
  });
});

function internals(component: UnlinkedMentionsCorePluginComponent): UnlinkedMentionsCorePluginComponentInternals {
  return castTo<UnlinkedMentionsCorePluginComponentInternals>(component);
}
