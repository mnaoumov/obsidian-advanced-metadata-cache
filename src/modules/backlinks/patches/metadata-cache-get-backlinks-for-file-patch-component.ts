import type {
  MetadataCache,
  TFile
} from 'obsidian';
import type { GetBacklinksForFileSafeWrapper } from 'obsidian-dev-utils/obsidian/metadata-cache';

import { MonkeyAroundComponent } from 'obsidian-dev-utils/obsidian/components/monkey-around-component';

import type { BacklinkCacheComponent } from '../backlink-cache-component.ts';

type GetBacklinksForFileFunction = MetadataCache['getBacklinksForFile'];

interface MetadataCacheGetBacklinksForFilePatchComponentConstructorParams {
  readonly backlinkCacheComponent: BacklinkCacheComponent;
  readonly metadataCache: MetadataCache;
}

export class MetadataCacheGetBacklinksForFilePatchComponent extends MonkeyAroundComponent {
  private readonly backlinkCacheComponent: BacklinkCacheComponent;
  private readonly metadataCache: MetadataCache;
  private originalMethod: GetBacklinksForFileFunction | null = null;

  public constructor(params: MetadataCacheGetBacklinksForFilePatchComponentConstructorParams) {
    super();
    this.metadataCache = params.metadataCache;
    this.backlinkCacheComponent = params.backlinkCacheComponent;
  }

  /**
   * Calls the method this patch replaced: Obsidian's own, or whatever another plugin had installed first.
   *
   * Kept in a field of this component rather than read off the patched method, so the published API can
   * offer it without anything being grafted onto an Obsidian function. Before the patch is installed the
   * method on the metadata cache is still the original, so that is what answers.
   *
   * @param file - The file to get the backlinks for.
   * @returns The backlinks for the file.
   */
  public getBacklinksForFileOriginal(file: TFile): ReturnType<GetBacklinksForFileFunction> {
    return (this.originalMethod ?? this.metadataCache.getBacklinksForFile).call(this.metadataCache, file);
  }

  public override onload(): void {
    this.registerMethodPatch({
      $object: this.metadataCache,
      methodName: 'getBacklinksForFile',
      patchHandler: ({
        originalArguments: [file]
      }) => {
        return this.backlinkCacheComponent.getBacklinksForFile(file);
      },
      postPatchHandler: ({
        originalMethod,
        patchedMethod
      }): GetBacklinksForFileFunction & GetBacklinksForFileSafeWrapper => {
        this.originalMethod = originalMethod;
        // Deprecated since 1.3.0, which publishes the same calls through the plugin API; removed in 2.0.0.
        return Object.assign(patchedMethod, {
          // eslint-disable-next-line unicorn/name-replacements -- `originalFn` is this plugin's documented public API - the README tells users to call it.
          originalFn: originalMethod.bind(this.metadataCache),
          safe: this.backlinkCacheComponent.getBacklinksForFileSafe.bind(this.backlinkCacheComponent)
        });
      }
    });
  }
}
