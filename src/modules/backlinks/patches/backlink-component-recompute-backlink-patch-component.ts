import type { ResultDomResult } from '@obsidian-typings/obsidian-public-latest';
import type { BacklinkComponent } from '@obsidian-typings/obsidian-public-latest/implementations';
import type {
  Reference,
  TFile
} from 'obsidian';
import type { CanvasData } from 'obsidian/canvas.js';

import { MonkeyAroundComponent } from '@mnaoumov/obsidian-lib/components/monkey-around-component';
import { isCanvasFile } from '@mnaoumov/obsidian-lib/file-system';
import { isFrontmatterLinkCacheWithOffsets } from '@mnaoumov/obsidian-lib/frontmatter-link-cache-with-offsets';
import { getBacklinksForFileSafe } from '@mnaoumov/obsidian-lib/metadata-cache';
import {
  isCanvasFileNodeReference,
  isCanvasReference,
  isCanvasTextNodeReference
} from '@mnaoumov/obsidian-lib/reference';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import { getPrototypeOf } from '@mnaoumov/typescript-lib/object-utils';
import {
  isFrontmatterLinkCache,
  isReferenceCache
} from '@obsidian-typings/obsidian-public-latest/implementations';

import { getFileComparer } from '../file-comparer.ts';

interface BacklinkComponentRecomputeBacklinkPatchComponentConstructorParams {
  readonly backlinkComponent: BacklinkComponent;
}

interface BacklinkComponentRecomputeBacklinkPatchComponentShowBacklinksParams {
  readonly backlinkComponent: BacklinkComponent;
  readonly backlinkNoteFile: TFile;
  readonly links: Reference[];
}

export class BacklinkComponentRecomputeBacklinkPatchComponent extends MonkeyAroundComponent {
  private readonly backlinkComponent: BacklinkComponent;

  public constructor(params: BacklinkComponentRecomputeBacklinkPatchComponentConstructorParams) {
    super();
    this.backlinkComponent = params.backlinkComponent;
  }

  public override onload(): void {
    this.registerMethodPatch({
      $object: getPrototypeOf(this.backlinkComponent),
      methodName: 'recomputeBacklink',
      patchHandler: ({
        originalArguments: [backlinkFile],
        originalThis
      }) => {
        invokeAsyncSafely(async () => {
          await this.recomputeBacklinkAsync(originalThis, backlinkFile);
        });
      }
    });
  }

  private async recomputeBacklinkAsync(backlinkComponent: BacklinkComponent, backlinkFile: null | TFile): Promise<void> {
    const app = backlinkComponent.app;
    backlinkComponent.stopBacklinkSearch();
    if (backlinkComponent.backlinkCollapsed) {
      backlinkComponent.backlinkCountEl.hide();
      return;
    }

    backlinkComponent.backlinkFile = backlinkFile;
    backlinkComponent.backlinkCountEl.show();
    backlinkComponent.backlinkCountEl.setText('0');
    backlinkComponent.backlinkDom.emptyResults();
    if (!backlinkFile) {
      return;
    }

    const backlinks = await getBacklinksForFileSafe({
      app,
      pathOrFile: backlinkFile
    });
    backlinkComponent.backlinkCountEl.setText(backlinks.count().toString());
    backlinkComponent.backlinkDom.changed();
    backlinkComponent.backlinkDom.emptyResults();

    const backlinkNoteFiles = backlinks.keys().map((path) => app.vault.getFileByPath(path)).filter((file) => !!file);
    backlinkNoteFiles.sort(getFileComparer(backlinkComponent.backlinkDom.sortOrder));

    for (const backlinkNoteFile of backlinkNoteFiles) {
      await this.showBacklinks({ backlinkComponent, backlinkNoteFile, links: backlinks.get(backlinkNoteFile.path) ?? [] });
    }

    backlinkComponent.backlinkCountEl.setText(backlinkComponent.backlinkDom.getMatchCount().toString());
    backlinkComponent.backlinkDom.changed();
  }

  private async showBacklinks(params: BacklinkComponentRecomputeBacklinkPatchComponentShowBacklinksParams): Promise<void> {
    const { backlinkComponent, backlinkNoteFile, links } = params;
    const app = backlinkComponent.app;
    let content = await app.vault.read(backlinkNoteFile);
    if (!backlinkComponent.passSearchFilter(backlinkNoteFile, content)) {
      return;
    }

    let canvasData: CanvasData | null = null;
    if (isCanvasFile(backlinkNoteFile)) {
      canvasData = JSON.parse(content) as CanvasData;
      content = patchCanvasContent(canvasData);
    }

    const contentMatches: NonNullable<ResultDomResult['content']> = [];
    const propertyMatches: NonNullable<ResultDomResult['properties']> = [];
    const resultDomResult: ResultDomResult = {
      content: contentMatches,
      properties: propertyMatches
    };
    let isValidLink = false;

    for (const link of links) {
      if (isReferenceCache(link)) {
        contentMatches.push([link.position.start.offset, link.position.end.offset]);
        isValidLink = true;
      } else if (isFrontmatterLinkCacheWithOffsets(link)) {
        const keys = link.key.split('.');
        propertyMatches.push({
          /* v8 ignore start -- split('.') always returns at least one element. */
          key: keys[0] ?? '',
          /* v8 ignore stop */
          pos: [link.startOffset, link.endOffset],
          subkey: toSubkey(keys.slice(1))
        });
        isValidLink = true;
      } else if (isFrontmatterLinkCache(link)) {
        const keys = link.key.split('.');
        propertyMatches.push({
          /* v8 ignore start -- split('.') always returns at least one element. */
          key: keys[0] ?? '',
          /* v8 ignore stop */
          pos: [0, link.original.length],
          subkey: toSubkey(keys.slice(1))
        });
        isValidLink = true;

        if (isCanvasFile(backlinkNoteFile)) {
          if (!isCanvasReference(link)) {
            console.warn('Unknown link type', {
              link
            });
            continue;
          }

          const node = canvasData?.nodes[link.nodeIndex];
          if (!node) {
            console.warn('Node not found', {
              link
            });
            continue;
          }

          let canvasNodeMatches = resultDomResult[`canvas-${node.id}`];
          if (!canvasNodeMatches) {
            canvasNodeMatches = [];
            resultDomResult[`canvas-${node.id}`] = canvasNodeMatches;
          }

          if (isCanvasFileNodeReference(link)) {
            if (typeof node.file !== 'string') {
              console.warn('Node file is not a string', {
                link,
                node
              });
              continue;
            }

            canvasNodeMatches.push([FILE_PREFIX.length, FILE_PREFIX.length + node.file.length]);
          } else if (isCanvasTextNodeReference(link)) {
            if (typeof node.text !== 'string') {
              console.warn('Node text is not a string', {
                link,
                node
              });
              continue;
            }

            if (isReferenceCache(link.originalReference)) {
              canvasNodeMatches.push([link.originalReference.position.start.offset, link.originalReference.position.end.offset]);
            } else {
              const index = node.text.indexOf(link.originalReference.original);
              canvasNodeMatches.push([index, index + link.originalReference.original.length]);
            }
          } else {
            console.warn('Unknown link type', {
              link
            });
            continue;
          }
        }
      }

      if (isValidLink) {
        backlinkComponent.backlinkDom.addResult(backlinkNoteFile, resultDomResult, content).renderContentMatches();
      }
    }
  }
}
const FILE_PREFIX = 'file: ';
function patchCanvasContent(canvasData: CanvasData): string {
  const patched: CanvasData = {
    edges: canvasData.edges,
    nodes: canvasData.nodes.map((node) => {
      if (node.type === 'file') {
        return {
          ...node,
          text: `${FILE_PREFIX}${node.file}`,
          type: 'text'
        };
      }

      return node;
    })
  };
  return JSON.stringify(patched);
}

/*
 * Built the way Obsidian 1.14.4's own backlink recompute builds it: a numeric segment becomes a number and any other
 * stays a string.
 */
function toSubkey(keys: string[]): (number | string)[] {
  return keys.map((key) => Number.isNaN(Number(key)) ? key : Number(key));
}
