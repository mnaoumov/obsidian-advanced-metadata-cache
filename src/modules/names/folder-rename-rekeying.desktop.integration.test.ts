import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type {
  PatchedGetLinkSuggestions,
  SettingsEditorPlugin
} from '../../../scripts/helpers/names-module.ts';

/*
 * The one claim about the name index that only a real Obsidian can settle: a FOLDER rename leaves
 * the index keyed by the NEW paths.
 *
 * The index is keyed by path, and a folder rename moves every descendant's path while changing not
 * one of their names. Obsidian's event order for the folder against its descendants is not a
 * contract, so a unit test can only prove the handler against whichever order the test itself
 * invents. This drives the real `fileManager.renameFile` and asserts the index answers with the new
 * paths afterwards, whatever order Obsidian used to get there.
 *
 * It also RECORDS that order, because the recording is the more durable half. Measured on Obsidian
 * 1.14.2: a folder rename fires a `rename` event per descendant as well as one for the folder, so
 * the descendants' own events are enough to keep the index correct today and the component's folder
 * branch is insurance rather than the thing that passes this test. The `firedRenamePaths`
 * assertion below is what goes red if that ever stops being true — at which point the folder branch
 * becomes load-bearing, and `name-index-component.test.ts` is where it is pinned.
 *
 * Names are deliberately unique to this suite: the desktop project shares one temporary vault
 * across every desktop suite.
 */

const PLUGIN_ID = 'advanced-metadata-cache';
const OLD_FOLDER_PATH = 'names-rekey-old';
const NEW_FOLDER_PATH = 'names-rekey-new';
const NOTE_BASENAME = 'names-rekey-inside';
const NOTE_ALIAS = 'names-rekey-nested';
const OLD_NOTE_PATH = `${OLD_FOLDER_PATH}/${NOTE_BASENAME}.md`;
const NEW_NOTE_PATH = `${NEW_FOLDER_PATH}/${NOTE_BASENAME}.md`;
const NOTE_CONTENT = `---\naliases:\n  - ${NOTE_ALIAS}\n---\n`;

const STEP_WAIT_IN_MS = 5000;
const STEP_POLL_IN_MS = 100;
const SCENARIO_TIMEOUT_IN_MS = 120_000;

describe('the name index survives a folder rename', () => {
  it('re-keys every descendant to its new path, whatever order Obsidian fires the events in', async () => {
    const result = await evalInObsidian({
      async callback({
        app,
        lib: { waitUntil },
        NEW_FOLDER_PATH: newFolderPath,
        NEW_NOTE_PATH: newNotePath,
        NOTE_ALIAS: noteAlias,
        NOTE_BASENAME: noteBasename,
        NOTE_CONTENT: noteContent,
        OLD_FOLDER_PATH: oldFolderPath,
        OLD_NOTE_PATH: oldNotePath,
        PLUGIN_ID: pluginId,
        STEP_POLL_IN_MS: pollMs,
        STEP_WAIT_IN_MS: waitMs
      }) {
        const firedRenamePaths: string[] = [];
        const plugin = app.plugins.getPlugin(pluginId) as null | SettingsEditorPlugin;

        if (!plugin) {
          return { error: 'Plugin not loaded', firedRenamePaths, pathsByAlias: [], pathsByBasename: [], suggestionPaths: [] };
        }

        function getPathsByName(name: string): string[] {
          return (app.metadataCache.getLinkSuggestions as PatchedGetLinkSuggestions).getPathsByName?.(name) ?? [];
        }

        try {
          await plugin.pluginSettingsComponent.editAndSave((settings) => {
            settings.isNamesModuleEnabled = true;
          });

          await app.vault.createFolder(oldFolderPath);
          await app.vault.create(oldNotePath, noteContent);

          // The module loads asynchronously off the settings save, and its index is built behind
          // `ensureMetadataCacheReady`, so this waits for both at once.
          await waitUntil({
            intervalInMilliseconds: pollMs,
            message: 'the name index to answer for the note before the rename',
            predicate: () => getPathsByName(noteBasename).includes(oldNotePath),
            timeoutInMilliseconds: waitMs
          });

          const folder = app.vault.getFolderByPath(oldFolderPath);

          if (!folder) {
            return { error: 'Folder not found', firedRenamePaths: [], pathsByAlias: [], pathsByBasename: [], suggestionPaths: [] };
          }

          const eventRef = app.vault.on('rename', (renamedFile, renamedOldPath) => {
            firedRenamePaths.push(`${renamedOldPath} -> ${renamedFile.path}`);
          });

          try {
            await app.fileManager.renameFile(folder, newFolderPath);
          } finally {
            app.vault.offref(eventRef);
          }

          await waitUntil({
            intervalInMilliseconds: pollMs,
            message: 'the name index to re-key the descendants of the renamed folder',
            predicate: () => getPathsByName(noteBasename).includes(newNotePath),
            timeoutInMilliseconds: waitMs
          });

          return {
            error: null,
            firedRenamePaths,
            pathsByAlias: getPathsByName(noteAlias),
            pathsByBasename: getPathsByName(noteBasename),
            suggestionPaths: app.metadataCache.getLinkSuggestions()
              .map((suggestion) => suggestion.path)
              .filter((path) => path.includes(noteBasename))
          };
        } finally {
          // The desktop vault is shared with every other suite, and this module is off by default.
          await plugin.pluginSettingsComponent.editAndSave((settings) => {
            settings.isNamesModuleEnabled = false;
          });
        }
      },
      input: {
        NEW_FOLDER_PATH,
        NEW_NOTE_PATH,
        NOTE_ALIAS,
        NOTE_BASENAME,
        NOTE_CONTENT,
        OLD_FOLDER_PATH,
        OLD_NOTE_PATH,
        PLUGIN_ID,
        STEP_POLL_IN_MS,
        STEP_WAIT_IN_MS
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();

    // Keyed by the NEW path, under both the basename and the alias - the alias half is what proves
    // the whole indexed entry moved rather than just the one name the wait polled on.
    expect(result.pathsByBasename).toEqual([NEW_NOTE_PATH]);
    expect(result.pathsByAlias).toEqual([NEW_NOTE_PATH]);

    // And the suggestion list moved with it: one entry for the file, one for its alias, both at the
    // new display path, with nothing left pointing into the old folder.
    expect(result.suggestionPaths).toEqual([
      `${NEW_FOLDER_PATH}/${NOTE_BASENAME}`,
      `${NEW_FOLDER_PATH}/${NOTE_BASENAME}`
    ]);

    /*
     * The recorded sequence, and the reason this file is worth its runtime. Obsidian fires a
     * `rename` for the FOLDER FIRST and then one per descendant, with the vault tree already
     * carrying the new paths by the time the folder event lands — which is what makes the
     * component's folder branch safe to run there. The descendant event alone would also keep a
     * path-keyed index correct, which is why that branch cannot be made red from here. A release
     * that stops firing the descendant event fails this assertion, and that is the moment the
     * folder branch starts carrying the plugin.
     */
    expect(result.firedRenamePaths).toEqual([
      `${OLD_FOLDER_PATH} -> ${NEW_FOLDER_PATH}`,
      `${OLD_NOTE_PATH} -> ${NEW_NOTE_PATH}`
    ]);
  }, SCENARIO_TIMEOUT_IN_MS);
});
