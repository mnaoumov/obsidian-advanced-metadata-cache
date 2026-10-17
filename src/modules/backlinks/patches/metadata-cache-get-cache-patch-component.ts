import type { MetadataCache } from 'obsidian';

import { MonkeyAroundComponent } from '@mnaoumov/obsidian-lib/components/monkey-around-component';
import { isCanvasFile } from '@mnaoumov/obsidian-lib/file-system';

import type { CanvasComponent } from '../canvas.ts';

interface MetadataCacheGetCachePatchComponentConstructorParams {
  readonly canvasComponent: CanvasComponent;
  readonly metadataCache: MetadataCache;
}

export class MetadataCacheGetCachePatchComponent extends MonkeyAroundComponent {
  private readonly canvasComponent: CanvasComponent;
  private readonly metadataCache: MetadataCache;

  public constructor(params: MetadataCacheGetCachePatchComponentConstructorParams) {
    super();
    this.metadataCache = params.metadataCache;
    this.canvasComponent = params.canvasComponent;
  }

  public override onload(): void {
    this.registerMethodPatch({
      $object: this.metadataCache,
      methodName: 'getCache',
      patchHandler: ({
        fallback,
        originalArguments: [path]
      }) => {
        // Route canvas files by extension alone — O(1). `isCanvasFile` checks the `.canvas`
        // extension string without resolving the path to a `TFile`.
        // Resolving a miss (an already-removed path during a delete cascade) would trigger an
        // O(vault) scan, which this hot patch must never do.
        if (!isCanvasFile(path)) {
          return fallback();
        }

        // Obsidian answers `{}` for a canvas. A non-empty answer is another plugin's full canvas entry
        // (`Advanced Canvas` builds one with the `frontmatter` and the node links), so it wins over the
        // links-only one here, whichever of the two patches was installed first.
        const cache = fallback();
        return cache && Object.keys(cache).length > 0 ? cache : this.canvasComponent.getCache(path);
      }
    });
  }
}
