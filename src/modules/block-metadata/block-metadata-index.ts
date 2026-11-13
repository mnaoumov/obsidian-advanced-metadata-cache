/**
 * @file
 *
 * The data behind the `Block metadata` module: every note's metadata fences, by path, and which notes hold a fence
 * naming each property, so a lookup by property reads only those notes.
 *
 * Owned by the plugin rather than by the module, like `LinkTextIndex`, because a subscription through
 * `onBlockMetadataChanged` must outlive the module being switched off and on.
 */

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';

import type {
  BlockMetadata,
  BlockMetadataChangedCallback,
  BlockMetadataMatch
} from '../../plugin-api.ts';

import { cloneJson } from './block-metadata-parser.ts';

/**
 * The per-path and per-property maps, and the listeners told when they change.
 */
export class BlockMetadataIndex {
  private readonly byPath = new Map<string, readonly BlockMetadata[]>();
  // Property name -> paths of the notes holding a fence that names it.
  private readonly byPropertyName = new Map<string, Set<string>>();
  private readonly listeners = new Set<BlockMetadataChangedCallback>();

  /**
   * Forgets everything, and tells the listeners so.
   */
  public clear(): void {
    this.byPath.clear();
    this.byPropertyName.clear();
    this.notify(null);
  }

  /**
   * Removes one note's fences, for a note that was deleted, moved away or lost them.
   *
   * @param path - The note's path.
   */
  public deletePath(path: string): void {
    this.setPath(path, []);
  }

  /**
   * Lists one note's fences.
   *
   * @param path - The note's path.
   * @returns Copies of its fences, in the order they appear in the note; empty for a note with none.
   */
  public getBlockMetadata(path: string): BlockMetadata[] {
    return cloneJson([...this.byPath.get(path) ?? []]);
  }

  /**
   * Finds every fence naming a property, and holding a value, when one is asked for.
   *
   * @param propertyName - The property name, matched exactly.
   * @param value - The value, matched exactly against a scalar's string form or against each scalar member of a
   *   list. Omitted, any value matches, `null` included.
   * @returns Copies of the matching fences with their notes' paths, by path in code-unit order, then in note order.
   */
  public getBlockMetadataWithProperty(propertyName: string, value?: string): BlockMetadataMatch[] {
    const paths = [...this.byPropertyName.get(propertyName) ?? []].sort(compareByCodeUnits);
    const matches: BlockMetadataMatch[] = [];

    for (const path of paths) {
      // A path is listed under a property name only while it holds fences.
      for (const blockMetadata of ensureNonNullable(this.byPath.get(path))) {
        if (!blockMetadata.properties || !Object.hasOwn(blockMetadata.properties, propertyName)) {
          continue;
        }

        if (value === undefined || getStringValues(blockMetadata.properties[propertyName]).includes(value)) {
          matches.push({ blockMetadata: cloneJson(blockMetadata), path });
        }
      }
    }

    return matches;
  }

  /**
   * Lists the indexed notes at a path or, for a folder, under it.
   *
   * @param path - A file or folder path.
   * @param isFolderPath - Whether the path is a folder's.
   * @returns The note paths.
   */
  public getPaths(path: string, isFolderPath: boolean): string[] {
    return [...this.byPath.keys()].filter((candidate) => isFolderPath ? candidate.startsWith(`${path}/`) : candidate === path);
  }

  /**
   * Carries one note's fences to the path it was renamed to: they depend on its text alone.
   *
   * @param oldPath - The path it had.
   * @param newPath - The path it has now.
   */
  public movePath(oldPath: string, newPath: string): void {
    const blockMetadataList = this.byPath.get(oldPath);

    /* v8 ignore next 3 -- The component moves only the paths it has just listed. */
    if (!blockMetadataList) {
      return;
    }

    this.deletePath(oldPath);
    this.setPath(newPath, blockMetadataList);
  }

  /**
   * Tells the listeners which notes changed.
   *
   * @param paths - The paths, or `null` when any note may have changed.
   */
  public notify(paths: null | string[]): void {
    for (const listener of this.listeners) {
      listener(paths);
    }
  }

  /**
   * Subscribes to changes.
   *
   * @param listener - Called with the paths of the notes whose fences changed, or `null` for any of them.
   * @returns A function that ends the subscription.
   */
  public onChange(listener: BlockMetadataChangedCallback): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Replaces one note's fences, and tells the listeners when that changed anything.
   *
   * @param path - The note's path.
   * @param blockMetadataList - Every fence it now holds.
   */
  public setPath(path: string, blockMetadataList: readonly BlockMetadata[]): void {
    const previous = this.byPath.get(path) ?? [];
    if (JSON.stringify(previous) === JSON.stringify(blockMetadataList)) {
      return;
    }

    for (const propertyName of getPropertyNames(previous)) {
      const paths = this.byPropertyName.get(propertyName);
      paths?.delete(path);
      if (paths?.size === 0) {
        this.byPropertyName.delete(propertyName);
      }
    }

    if (blockMetadataList.length === 0) {
      this.byPath.delete(path);
    } else {
      this.byPath.set(path, blockMetadataList);
    }

    for (const propertyName of getPropertyNames(blockMetadataList)) {
      let paths = this.byPropertyName.get(propertyName);
      if (!paths) {
        paths = new Set();
        this.byPropertyName.set(propertyName, paths);
      }
      paths.add(path);
    }

    this.notify([path]);
  }
}

// The same order on every machine, whatever its locale. Only ever sorts a set's members, so no two are equal.
function compareByCodeUnits(a: string, b: string): number {
  return a < b ? -1 : 1;
}

function getPropertyNames(blockMetadataList: readonly BlockMetadata[]): Set<string> {
  const propertyNames = new Set<string>();
  for (const blockMetadata of blockMetadataList) {
    for (const propertyName of Object.keys(blockMetadata.properties ?? {})) {
      propertyNames.add(propertyName);
    }
  }
  return propertyNames;
}

/**
 * The string forms a value matches, read the way the `Properties` module reads a frontmatter value: a scalar is one,
 * a list contributes each scalar member, and `null` or a mapping contributes nothing.
 *
 * @param value - The property's value.
 * @returns Its string forms.
 */
function getStringValues(value: unknown): string[] {
  const members: unknown[] = Array.isArray(value) ? value : [value];
  return members.filter((member) => typeof member === 'string' || typeof member === 'number' || typeof member === 'boolean').map(String);
}
