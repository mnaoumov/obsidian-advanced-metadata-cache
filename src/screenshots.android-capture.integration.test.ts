/**
 * @file
 *
 * Produces the mobile screenshots the community-store listing needs,
 * driving Obsidian Mobile on a real Android emulator and writing
 * `images/screenshots/screenshot-mobile-N.png`.
 *
 * Worth taking on a phone because that is where the cost is felt first: the same
 * scan that is merely slow on a laptop is what makes the Backlinks pane sit and
 * think on a phone. The vault here is smaller than the desktop one — every note
 * has to be pushed onto the device before Obsidian opens it — and the difference
 * is measured on the device anyway, so the numbers in frame are the phone's.
 *
 * The numbers in frame are measured in that vault, in the same run, on the same
 * note: the patched lookup, then Obsidian's own implementation reached through
 * `getBacklinksForFile.originalFn`. Nothing is quoted from a benchmark elsewhere,
 * and the assertion requires the patched path to actually be faster before the
 * frame claiming so is written.
 *
 * What this suite is NOT allowed to do is flake. Measured 2026-09-23, the same code ran red and then
 * green three minutes apart, and the difference was the host: an emulator sharing the machine with
 * another project's made staging the vault ~50x slower, and the run died inside the hook having
 * written nothing. So the hook refuses a contended machine outright before it stages anything, and
 * everything after that is bounded by a wall clock taken from the project's own hook budget rather
 * than by a poll count that silently means a different budget on every run.
 */

import {
  mkdirSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { sleep as sleepInNode } from 'obsidian-dev-utils/async';
import {
  captureObsidianScreenshot,
  evalInObsidian,
  labelScreenshot,
  readPngDimensions
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

import { assertNoForeignEmulator } from '../scripts/helpers/android-emulator-contention.ts';
import { computeCaptureDeadline } from '../scripts/helpers/capture-budget.ts';
import { SCREENSHOT_AVD_NAME } from '../scripts/helpers/screenshot-avd.ts';

/**
 * The dictionary either implementation answers with, reduced to its keys.
 */
interface BacklinkDictionary {
  keys: (this: void) => string[];
}

/**
 * `App`, reduced to the font-size applier that `obsidian-typings` does not
 * declare. Setting `baseFontSize` alone changes nothing on screen.
 */
interface FontSizeApp {
  updateFontSize: (this: void) => void;
}

/**
 * `App`, reduced to the inline-title toggle that `obsidian-typings` does not
 * declare. Setting the config alone changes nothing on screen.
 */
interface InlineTitleApp {
  updateInlineTitleDisplay: (this: void) => void;
}

/**
 * The backlink lookup as this plugin leaves it: callable as before, plus the
 * `originalFn` handle onto Obsidian's own implementation, which is what makes a
 * fair side-by-side measurement possible at all.
 */
interface PatchedGetBacklinksForFile {
  (this: void, file: unknown): BacklinkDictionary;
  // eslint-disable-next-line unicorn/name-replacements -- `originalFn` is the plugin's own public property name, not ours to rename.
  originalFn: (this: void, file: unknown) => BacklinkDictionary;
}

const WIDTH_IN_PIXELS = 900;
const HEIGHT_IN_PIXELS = 1600;

/**
 * The note everything points at, and the folder the pointing notes live in.
 */
const HUB_NOTE_PATH = 'Projects/Website redesign.md';
const LINKING_FOLDER = 'Journal';

/**
 * How many notes link to the hub. Enough that the Backlinks pane is worth looking
 * at, and enough that Obsidian's own scan has something to do.
 */
const LINKING_NOTE_COUNT = 120;

/**
 * How many other notes the vault holds. This is the only reason any of this is
 * worth measuring: the plugin answers from an index, so its cost does not move
 * with this number, while Obsidian's own implementation walks all of it.
 */
const FILLER_NOTE_COUNT = 400;

/**
 * How many linking notes may fail to reach the device before the run is wrong
 * rather than merely unlucky.
 */
const MISSING_NOTE_TOLERANCE = 3;

/**
 * How much faster the cached lookup has to be before a frame may say so.
 */
const REQUIRED_SPEEDUP = 2;

/**
 * Where the measured numbers are written so they can be photographed. A `Notice`
 * would be the obvious place and is out of reach: a serialized closure has no
 * imports, so it cannot construct one.
 */
const RESULT_NOTE_PATH = 'Measurements.md';

/**
 * Base font size for the mobile shots.
 */
const MOBILE_FONT_SIZE_IN_PIXELS = 13;

/**
 * How many milliseconds a second is, so the failure messages read in the unit their reader compares
 * runs in.
 */
const MILLISECONDS_PER_SECOND = 1000;

/**
 * The plugin's own id, which is also the id of its settings tab.
 */
const PLUGIN_ID = 'advanced-metadata-cache';

/**
 * How many notes are PUSHED onto the device: the hub, the notes linking to it, and the filler.
 *
 * Obsidian can settle below it, which is the same tolerance {@link MISSING_NOTE_TOLERANCE} already
 * exists for: an archive extracted onto a device into a vault that is already open is seen through
 * Android's own file watching, and a few of several hundred notes arriving at once go unseen. The
 * desktop twin of this constant records the same effect measured at a larger scale.
 *
 * So this is the ceiling the wait below stops AT, never the figure it holds out for. What it waits
 * for is the count to stop moving, because the backlink count is no use as a settle signal: it
 * reaches its own total while the filler is still arriving, which is how the desktop suite's first
 * frame came out reporting a vault a third smaller than the one the caption describes.
 */
const STAGED_NOTE_COUNT = 1 + LINKING_NOTE_COUNT + FILLER_NOTE_COUNT;

/**
 * How many consecutive unchanged polls mean the vault has stopped growing rather than merely paused.
 */
const SETTLED_POLL_COUNT = 3;

/**
 * How many consecutive unchanged polls mean the staging is STUCK rather than slow, when the vault
 * has stopped growing somewhere it must not stop - short of the backlinks the frames are about.
 *
 * Deliberately far above {@link SETTLED_POLL_COUNT}: ~170s at the measured poll cost. A contended
 * device delivers its notes in bursts with real pauses between them, and a pause misread as a stall
 * would fail a run that was going to succeed. What this catches is the count that has not moved at
 * all - a watcher that never saw the extract, an app that never opened the vault - where the rest of
 * the budget buys nothing but a later, emptier failure.
 */
const STALLED_POLL_COUNT = 40;

/**
 * The module rows the settings tab leads with, in the order it renders them.
 *
 * Asserted rather than merely photographed: the frame's caption says every index is a module of its
 * own, and this is what stops that caption outliving the settings tab it describes.
 */
const EXPECTED_MODULE_SETTING_NAMES = ['Backlinks module', 'Names module', 'Titles module'];

/**
 * What every module row's name ends with, and so how a module row is told from the rows that
 * configure one.
 */
const MODULE_SETTING_NAME_SUFFIX = ' module';

const IMAGES_DIRECTORY = join(process.cwd(), 'images', 'screenshots');

/**
 * The measurement, taken once and reused by the frames that report it.
 */
let measurement: BacklinkMeasurement | null = null;

beforeAll(async () => {
  /*
   * The hook's clock, started here rather than at the wait below, so staging the vault is spent out
   * of the same budget instead of quietly extending it. Everything this hook does afterwards is
   * sized against it.
   */
  const hookStartedAtInMilliseconds = Date.now();

  /*
   * The authoritative half of the contention preflight - `npm run capture:screenshots` runs the same
   * check before vitest starts, but this one also covers a direct `--project` run, and an emulator
   * can appear on the machine while the desktop leg is still going.
   *
   * It is the FIRST thing here on purpose: refusing costs a second, and the alternative is the
   * thirteen minutes of staging and polling that produced no frame on 2026-09-23.
   */
  await assertNoForeignEmulator(SCREENSHOT_AVD_NAME);

  const vault = getTemporaryVault();

  vault.populate(buildVault());

  /*
   * Timed because it is the cheapest honest reading of what this machine is doing: the same extract
   * took 0.2 s with the machine quiet and 11.2 s with a foreign emulator on it. It is carried into
   * every failure message below, so a run that dies later says outright which of the two it was.
   */
  const stagingStartedAtInMilliseconds = Date.now();
  await vault.syncToDevice();
  const stagingDurationInMilliseconds = Date.now() - stagingStartedAtInMilliseconds;

  await evalInObsidian({
    async callback({ app, fontSizeInPixels, hubNotePath, lib: { waitUntil }, linkingNoteCount }) {
      /*
       * Under the transport's ~30s per-closure cap, not at it.
       * Read and deliberately left as it is; the desktop twin of this closure carries the same reasoning.
       * The ceiling below is the whole budget bar a 1_500 settle, and it waits for a vault of thousands
       * of notes to become readable - on a phone, which is the slowest place that happens.
       * Tightening it would trade a failure that names the wait for one that photographs a half-indexed
       * vault.
       */
      const INDEX_TIMEOUT_IN_MILLISECONDS = 25_000;
      const SETTLE_DELAY_IN_MILLISECONDS = 1500;

      app.changeTheme('obsidian');

      await waitUntil({
        message: 'the staged vault to appear',
        predicate: () => Boolean(app.vault.getFileByPath(hubNotePath)),
        timeoutInMilliseconds: INDEX_TIMEOUT_IN_MILLISECONDS
      });

      // The drawer foot shows the harness generated vault name, which belongs in
      // no listing.
      const style = createEl('style');
      style.textContent = '.workspace-drawer-vault-switcher, .workspace-drawer-header-switcher { visibility: hidden; }';
      document.head.append(style);

      app.vault.setConfig('baseFontSize', fontSizeInPixels);
      const fontApp: unknown = app;
      (fontApp as FontSizeApp).updateFontSize();

      app.vault.setConfig('showInlineTitle', false);
      const inlineTitleApp: unknown = app;
      (inlineTitleApp as InlineTitleApp).updateInlineTitleDisplay();

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      return { linkingNoteCount };
    },
    input: { fontSizeInPixels: MOBILE_FONT_SIZE_IN_PIXELS, hubNotePath: HUB_NOTE_PATH, linkingNoteCount: LINKING_NOTE_COUNT },
    vaultPath: vaultPath()
  });

  // Indexing thousands of notes takes Obsidian a while, and every frame below is
  // meaningless until it has finished — a Backlinks pane that is still filling in
  // photographs as a plugin that found nothing.
  await waitForIndex({
    deadlineInMilliseconds: computeCaptureDeadline(hookStartedAtInMilliseconds),
    stagingDurationInMilliseconds
  });
});

describe('mobile store screenshots', () => {
  it('1 - the backlinks of a note in a big vault', async () => {
    const backlinkCount = await openBacklinksPane();
    // Not an exact count: pushing a few hundred notes onto the device drops the
    // odd one, and a frame is not worth failing over one journal entry. The
    // caption says no number for the same reason.
    expect(backlinkCount).toBeGreaterThanOrEqual(LINKING_NOTE_COUNT - MISSING_NOTE_TOLERANCE);
    await shoot(1, 'The Backlinks module: every backlink of this note, in one list');
  });

  it('2 - how long each way takes', async () => {
    measurement = await measureBacklinkLookups();
    // The frame reports numbers; this is what stops it reporting a lie.
    expect(measurement.cachedInMilliseconds).toBeLessThan(measurement.originalInMilliseconds / REQUIRED_SPEEDUP);
    await shoot(2, 'Answered from an index, not a scan of every note');
  });

  it('3 - the same answer, either way', async () => {
    const counts = await compareBacklinkCounts();
    // Faster is only worth anything if it is also right. The two implementations
    // must agree exactly; what that agreed number is does not matter here.
    expect(counts.cached).toBe(counts.original);
    expect(counts.cached).toBeGreaterThanOrEqual(LINKING_NOTE_COUNT - MISSING_NOTE_TOLERANCE);
    await shoot(3, 'The same answer as Obsidian, arrived at faster');
  });

  it('4 - every index is a module of its own', async () => {
    const moduleSettingNames = await openSettingsTab();

    // The whole point of the frame: three modules, and the backlink one leading. A set of frames
    // showing only backlinks would photograph the plugin this was ported FROM.
    expect(moduleSettingNames).toStrictEqual(EXPECTED_MODULE_SETTING_NAMES);
    await shoot(4, 'The same modules, on the phone');
  });
});

/**
 * Builds the vault the shots are taken in.
 *
 * Named like a vault someone actually keeps: the frames show the file explorer,
 * and `big/dir-3/file-17.md` would photograph as a benchmark rather than as the
 * situation the reader is in.
 *
 * @returns A map of vault-relative paths to content.
 */
function buildVault(): Record<string, string> {
  const files: Record<string, string> = {
    [HUB_NOTE_PATH]: '# Website redesign\n\nThe project everything else refers back to.\n'
  };

  const topics = ['Standup', 'Review', 'Retro', 'Planning', 'Handover'];

  for (let index = 0; index < LINKING_NOTE_COUNT; index++) {
    const topic = topics[index % topics.length] ?? 'Standup';
    const day = (index % 28) + 1;
    const month = (index % 12) + 1;
    const paddedMonth = String(month).padStart(2, '0');
    const paddedDay = String(day).padStart(2, '0');
    files[`${LINKING_FOLDER}/2026-${paddedMonth}/2026-${paddedMonth}-${paddedDay} ${topic}.md`] = `# ${topic}\n\nPicked up again on [[Website redesign]].\n`;
  }

  // The filler notes LINK to each other. An empty note costs Obsidian's own
  // implementation nothing to walk, so a vault of empty notes would have measured
  // A difference that no reader's vault would reproduce — real vaults are full of
  // links, and links are what that implementation re-reads on every question.
  for (let index = 0; index < FILLER_NOTE_COUNT; index++) {
    const folder = `Archive/${String(2010 + (index % 15))}`;
    const firstNeighbor = (index + 1) % FILLER_NOTE_COUNT;
    const secondNeighbor = (index + 7) % FILLER_NOTE_COUNT;
    files[`${folder}/Note ${String(index)}.md`] = [
      `# Note ${String(index)}`,
      '',
      `Older material. See also [[Note ${String(firstNeighbor)}]] and [[Note ${String(secondNeighbor)}]].`,
      ''
    ].join('\n');
  }

  return files;
}

/**
 * Asks for the backlink count both ways.
 *
 * @returns What each implementation answered.
 */
async function compareBacklinkCounts(): Promise<BacklinkCounts> {
  return await evalInObsidian({
    async callback({ app, hubNotePath, resultNotePath }) {
      const SETTLE_DELAY_IN_MILLISECONDS = 1500;
      const RESIZE_SETTLE_DELAY_IN_MILLISECONDS = 2000;

      await sleep(RESIZE_SETTLE_DELAY_IN_MILLISECONDS);

      // Shot 1 left a Backlinks tab and an expanded right dock behind. They would
      // sit in this frame reporting "No backlinks found" for the results note,
      // which is true and completely beside the point.
      for (const backlinkLeaf of app.workspace.getLeavesOfType('backlink')) {
        backlinkLeaf.detach();
      }

      app.workspace.rightSplit.collapse();
      app.workspace.leftSplit.collapse();

      /**
       * Writes the measured numbers into a note and opens it, which is what the
       * shot photographs. Defined here rather than at module scope because a
       * serialized closure carries no outer functions with it.
       *
       * @param lines - The note's Markdown, line by line.
       */
      async function writeResultNote(lines: string[]): Promise<void> {
        const content = lines.join('\n');
        const existing = app.vault.getFileByPath(resultNotePath);
        const resultFile = existing ?? await app.vault.create(resultNotePath, content);
        if (existing) {
          await app.vault.modify(existing, content);
        }

        await app.workspace.getLeaf(false).openFile(resultFile);
        await app.workspace.getLeaf(false).setViewState({
          state: { file: resultNotePath, mode: 'preview', source: false },
          type: 'markdown'
        });
      }

      const file = app.vault.getFileByPath(hubNotePath);
      if (!file) {
        throw new Error(`Note is missing from the vault: ${hubNotePath}`);
      }

      const lookup: unknown = app.metadataCache.getBacklinksForFile;
      const getBacklinksForFile = lookup as PatchedGetBacklinksForFile;
      const cached = getBacklinksForFile(file).keys().length;
      const original = getBacklinksForFile.originalFn(file).keys().length;

      await writeResultNote([
        '# Backlinks for Website redesign',
        '',
        '| Asked | Answer |',
        '| --- | --- |',
        `| From the cache | ${String(cached)} backlinks |`,
        `| Obsidian's own | ${String(original)} backlinks |`
      ]);

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      return { cached, original };
    },
    input: { hubNotePath: HUB_NOTE_PATH, resultNotePath: RESULT_NOTE_PATH },
    vaultPath: vaultPath()
  });
}

/**
 * Writes what a failed index wait knows into one message.
 *
 * The whole point of the wait throwing on its own terms rather than letting vitest's hook timeout
 * fire: `Hook timed out in 600000ms` names neither the vault, nor the counts, nor the machine, and
 * that is precisely the message the 2026-09-23 red run left behind after thirteen minutes.
 *
 * @param params - What the wait saw.
 * @returns The message.
 */
function describeFailedIndexWait(params: FailedIndexWaitParams): string {
  const { headline, pollCount, progress, stagingDurationInMilliseconds, waitedInMilliseconds } = params;

  return [
    headline,
    `Last seen: ${String(progress.markdownFileCount)} of ${String(STAGED_NOTE_COUNT)} notes, `
    + `${String(progress.backlinkCount)} of ${String(LINKING_NOTE_COUNT)} backlinks, `
    + `after ${String(pollCount)} polls over ${formatSeconds(waitedInMilliseconds)}.`,
    '',
    `Staging the vault onto the device took ${formatSeconds(stagingDurationInMilliseconds)}, which is this run's own`,
    'reading of how busy the machine is: measured 2026-09-23, the same extract took 0.2 s with the',
    'machine to itself and 11.2 s with another emulator on it. If it is the slow figure, the device',
    'was sharing the host and no budget this suite could carry would have covered it - capture again',
    'once the machine is quiet.'
  ].join('\n');
}

/**
 * Renders a duration the way a reader compares it: in seconds, to one decimal.
 *
 * @param durationInMilliseconds - The duration.
 * @returns The duration in seconds, e.g. `11.2 s`.
 */
function formatSeconds(durationInMilliseconds: number): string {
  return `${(durationInMilliseconds / MILLISECONDS_PER_SECOND).toFixed(1)} s`;
}

/**
 * Times both implementations over the same note.
 *
 * @returns The two timings, in milliseconds.
 */
async function measureBacklinkLookups(): Promise<BacklinkMeasurement> {
  return await evalInObsidian({
    async callback({ app, hubNotePath, iterations, resultNotePath }) {
      const SETTLE_DELAY_IN_MILLISECONDS = 1500;
      const RESIZE_SETTLE_DELAY_IN_MILLISECONDS = 2000;

      await sleep(RESIZE_SETTLE_DELAY_IN_MILLISECONDS);

      // Shot 1 left a Backlinks tab and an expanded right dock behind. They would
      // sit in this frame reporting "No backlinks found" for the results note,
      // which is true and completely beside the point.
      for (const backlinkLeaf of app.workspace.getLeavesOfType('backlink')) {
        backlinkLeaf.detach();
      }

      app.workspace.rightSplit.collapse();
      app.workspace.leftSplit.collapse();

      /**
       * Writes the measured numbers into a note and opens it, which is what the
       * shot photographs. Defined here rather than at module scope because a
       * serialized closure carries no outer functions with it.
       *
       * @param lines - The note's Markdown, line by line.
       */
      async function writeResultNote(lines: string[]): Promise<void> {
        const content = lines.join('\n');
        const existing = app.vault.getFileByPath(resultNotePath);
        const resultFile = existing ?? await app.vault.create(resultNotePath, content);
        if (existing) {
          await app.vault.modify(existing, content);
        }

        await app.workspace.getLeaf(false).openFile(resultFile);
        await app.workspace.getLeaf(false).setViewState({
          state: { file: resultNotePath, mode: 'preview', source: false },
          type: 'markdown'
        });
      }

      const file = app.vault.getFileByPath(hubNotePath);
      if (!file) {
        throw new Error(`Note is missing from the vault: ${hubNotePath}`);
      }

      const lookup: unknown = app.metadataCache.getBacklinksForFile;
      const getBacklinksForFile = lookup as PatchedGetBacklinksForFile;

      function measure(run: () => void): number {
        const start = performance.now();
        for (let iteration = 0; iteration < iterations; iteration++) {
          run();
        }

        return (performance.now() - start) / iterations;
      }

      const cachedInMilliseconds = measure(() => {
        getBacklinksForFile(file);
      });
      const originalInMilliseconds = measure(() => {
        getBacklinksForFile.originalFn(file);
      });

      await writeResultNote([
        `# Backlinks for ${file.basename}`,
        '',
        `Averaged over ${String(iterations)} calls, in a vault of ${String(app.vault.getMarkdownFiles().length)} notes.`,
        '',
        '| Asked | Time |',
        '| --- | --- |',
        `| From the cache | ${cachedInMilliseconds.toFixed(3)} ms |`,
        `| Obsidian's own | ${originalInMilliseconds.toFixed(3)} ms |`
      ]);

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      return { cachedInMilliseconds, originalInMilliseconds };
    },
    input: { hubNotePath: HUB_NOTE_PATH, iterations: MEASUREMENT_ITERATIONS, resultNotePath: RESULT_NOTE_PATH },
    vaultPath: vaultPath()
  });
}

/**
 * Opens the hub note with the Backlinks pane beside it.
 *
 * @returns How many backlinks the pane is showing.
 */
async function openBacklinksPane(): Promise<number> {
  return await evalInObsidian({
    async callback({ app, hubNotePath, lib: { waitUntil } }) {
      /*
       * Under the transport's ~30s per-closure cap, not at it.
       * Read and deliberately left as it is; the desktop twin of this closure carries the same reasoning.
       * The ceiling waits for the Backlinks pane to fill from a vault of thousands of notes, which is the
       * slow step rather than a generous margin over a quick one, and a pane still filling in is what
       * this frame must never show.
       */
      const RENDER_TIMEOUT_IN_MILLISECONDS = 25_000;
      const SETTLE_DELAY_IN_MILLISECONDS = 2000;

      const file = app.vault.getFileByPath(hubNotePath);
      if (!file) {
        throw new Error(`Note is missing from the vault: ${hubNotePath}`);
      }

      await app.workspace.getLeaf(false).openFile(file);

      // ONE pane, in the right dock where Obsidian normally keeps it. The
      // `backlink:open-backlinks` command opens a second one as a tab in the main
      // area, and a frame showing the same list twice reads as a mistake.
      for (const staleLeaf of app.workspace.getLeavesOfType('backlink')) {
        staleLeaf.detach();
      }

      app.workspace.rightSplit.expand();
      const backlinkLeaf = app.workspace.getRightLeaf(false);
      if (!backlinkLeaf) {
        throw new Error('Obsidian offered no right-dock leaf for the backlinks pane.');
      }

      await backlinkLeaf.setViewState({ active: true, type: 'backlink' });
      await app.workspace.revealLeaf(backlinkLeaf);

      // The file explorer would otherwise take a third of the frame for folders
      // nobody is reading.
      app.workspace.leftSplit.collapse();

      await waitUntil({
        message: 'the backlinks pane to fill',
        predicate: () => document.querySelectorAll('.backlink-pane .search-result-file-title').length > 0,
        timeoutInMilliseconds: RENDER_TIMEOUT_IN_MILLISECONDS
      });

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      return app.metadataCache.getBacklinksForFile(file).keys().length;
    },
    input: { hubNotePath: HUB_NOTE_PATH },
    vaultPath: vaultPath()
  });
}

/**
 * Opens the plugin's own settings tab, which is where the modules are switched on and off.
 *
 * Left in its default state deliberately — Backlinks on, Names and Titles off — because that IS the
 * shape a reader meets: one module doing the work it was installed for, and two more they can switch
 * on. Toggling one here would photograph a vault nobody has.
 *
 * @returns The names of the rendered module rows, in render order.
 */
async function openSettingsTab(): Promise<string[]> {
  return await evalInObsidian({
    async callback({ app, lib: { waitUntil }, moduleSettingNameSuffix, pluginId }) {
      const RENDER_TIMEOUT_IN_MILLISECONDS = 20_000;
      const OPEN_DELAY_IN_MILLISECONDS = 500;
      const SETTLE_DELAY_IN_MILLISECONDS = 1500;

      // The earlier frames left a results note, a Backlinks tab and an expanded dock behind. The
      // settings modal covers all of it, but a notice would sit on TOP of the modal.
      for (const noticeEl of document.querySelectorAll('.notice')) {
        noticeEl.detach();
      }

      app.setting.open();
      await sleep(OPEN_DELAY_IN_MILLISECONDS);
      app.setting.openTabById(pluginId);

      await waitUntil({
        message: 'the settings tab to render its module rows',
        predicate: () =>
          [...document.querySelectorAll('.setting-item-name')]
            .some((settingNameEl) => settingNameEl.textContent.endsWith(moduleSettingNameSuffix)),
        timeoutInMilliseconds: RENDER_TIMEOUT_IN_MILLISECONDS
      });

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      return [...document.querySelectorAll('.setting-item-name')]
        .map((settingNameEl) => settingNameEl.textContent)
        .filter((settingName) => settingName.endsWith(moduleSettingNameSuffix));
    },
    input: { moduleSettingNameSuffix: MODULE_SETTING_NAME_SUFFIX, pluginId: PLUGIN_ID },
    vaultPath: vaultPath()
  });
}

/**
 * Captures the window, captions it, and writes it as
 * `images/screenshots/screenshot-mobile-<index>.png`.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 */
async function shoot(index: number, caption: string): Promise<void> {
  const captured = await captureObsidianScreenshot({ vaultPath: vaultPath() });

  // The AVD is 900x1600, so the device frame IS the store's size. Asserting it
  // here is what keeps that true: run this against any other AVD and it fails
  // loudly instead of quietly shipping an off-spec image.
  expect(readPngDimensions(captured)).toStrictEqual({
    heightInPixels: HEIGHT_IN_PIXELS,
    widthInPixels: WIDTH_IN_PIXELS
  });

  const labeled = await labelScreenshot(captured, { text: caption });

  mkdirSync(IMAGES_DIRECTORY, { recursive: true });
  writeFileSync(join(IMAGES_DIRECTORY, `screenshot-mobile-${String(index)}.png`), labeled);
}

function vaultPath(): string {
  return getTemporaryVault().path;
}

/**
 * Waits for Obsidian to have read the whole staged vault, and for the plugin's index to hold every
 * linking note.
 *
 * Both halves, because they finish at different times: a frame taken before the pane settles shows a
 * half-built list, and one taken before the vault settles reports a smaller vault than the caption
 * claims.
 *
 * Bounded by a WALL CLOCK rather than by a poll count, because a poll is not a fixed cost: it is
 * ~4.3s on this emulator rather than the 3s its sleep suggests - every `evalInObsidian` pays an
 * Appium preflight round trip on top - and on a contended machine it is worse again. A poll ceiling
 * therefore means a different budget on every run, which is how a ceiling of 140 came to spend the
 * WHOLE 600s hook and hand the reader a bare `Hook timed out in 600000ms` with the counts that would
 * have explained it never printed. The deadline comes from the project's own hook budget, so the two
 * cannot drift apart.
 *
 * @param params - The budget this wait must land inside, and what staging the vault already cost.
 * @returns A {@link Promise} that resolves once the vault is worth photographing.
 */
async function waitForIndex({ deadlineInMilliseconds, stagingDurationInMilliseconds }: WaitForIndexParams): Promise<void> {
  const INTERVAL_IN_MILLISECONDS = 3000;

  const startedAtInMilliseconds = Date.now();
  // No initializer: the `do` below assigns it before anything reads it, which is also what lets
  // every failure message below report real counts rather than a placeholder.
  let progress: StagingProgress;
  let lastMarkdownFileCount = -1;
  let pollCount = 0;
  let settledPollCount = 0;

  // A `do` rather than a `while`, so the vault is asked at least once however little of the budget
  // staging left behind. A deadline that has already passed must still produce counts to report;
  // "0 of 521 notes after 0 polls" would read as a vault that never appeared rather than as one that
  // was never asked.
  do {
    progress = await readStagingProgress();
    pollCount++;

    settledPollCount = progress.markdownFileCount === lastMarkdownFileCount ? settledPollCount + 1 : 0;
    lastMarkdownFileCount = progress.markdownFileCount;

    // Everything arrived, which is the happy ending and the only one that needs no settling.
    if (progress.markdownFileCount >= STAGED_NOTE_COUNT && progress.backlinkCount >= LINKING_NOTE_COUNT) {
      return;
    }

    // Or it stopped arriving, which is the ordinary ending: whatever the watcher dropped is dropped,
    // and the vault Obsidian has is the vault the frames will report.
    if (settledPollCount >= SETTLED_POLL_COUNT && progress.backlinkCount >= LINKING_NOTE_COUNT - MISSING_NOTE_TOLERANCE) {
      return;
    }

    // Or it stopped arriving somewhere it must not stop, which is not slowness and will not improve
    // by being waited on. Failing here hands back the rest of the budget AND the counts.
    if (settledPollCount >= STALLED_POLL_COUNT) {
      throw new Error(describeFailedIndexWait({
        headline: 'The staged vault stopped growing well short of what was pushed onto the device.',
        pollCount,
        progress,
        stagingDurationInMilliseconds,
        waitedInMilliseconds: Date.now() - startedAtInMilliseconds
      }));
    }

    await sleepInNode({ milliseconds: INTERVAL_IN_MILLISECONDS });
  } while (Date.now() < deadlineInMilliseconds);

  throw new Error(describeFailedIndexWait({
    headline: 'The vault never finished indexing inside the capture budget.',
    pollCount,
    progress,
    stagingDurationInMilliseconds,
    waitedInMilliseconds: Date.now() - startedAtInMilliseconds
  }));
}

/**
 * How many times each implementation is called before its average is taken.
 */
const MEASUREMENT_ITERATIONS = 20;

/**
 * What each implementation answered.
 */
interface BacklinkCounts {
  readonly cached: number;
  readonly original: number;
}

/**
 * How long each implementation took, in milliseconds.
 */
interface BacklinkMeasurement {
  readonly cachedInMilliseconds: number;
  readonly originalInMilliseconds: number;
}

/**
 * Everything a failed index wait knows, which is everything its message should say.
 */
interface FailedIndexWaitParams {
  /**
   * What went wrong, in one sentence.
   */
  readonly headline: string;

  /**
   * How many times the vault was asked.
   */
  readonly pollCount: number;

  /**
   * How far the staging had got when the wait gave up.
   */
  readonly progress: StagingProgress;

  /**
   * How long `syncToDevice` took, which is this run's own reading of how busy the machine is.
   */
  readonly stagingDurationInMilliseconds: number;

  /**
   * How long the wait itself ran for.
   */
  readonly waitedInMilliseconds: number;
}

/**
 * How far Obsidian has got through the staged vault.
 */
interface StagingProgress {
  readonly backlinkCount: number;
  readonly markdownFileCount: number;
}

/**
 * What {@link waitForIndex} is given.
 */
interface WaitForIndexParams {
  /**
   * The `Date.now()` value the wait must not run past, from
   * {@link computeCaptureDeadline}.
   */
  readonly deadlineInMilliseconds: number;

  /**
   * How long staging the vault onto the device took.
   */
  readonly stagingDurationInMilliseconds: number;
}

/**
 * Asks how far the staging has got.
 *
 * Polled from the Node side: staging thousands of notes outlasts the transport's per-call cap, so the
 * wait cannot live inside one closure.
 *
 * @returns How much of the vault Obsidian has read, and how much of the hub's backlinks it has found.
 */
async function readStagingProgress(): Promise<StagingProgress> {
  return await evalInObsidian({
    callback({ app, hubNotePath }) {
      const file = app.vault.getFileByPath(hubNotePath);
      return {
        backlinkCount: file ? app.metadataCache.getBacklinksForFile(file).keys().length : 0,
        markdownFileCount: app.vault.getMarkdownFiles().length
      };
    },
    input: { hubNotePath: HUB_NOTE_PATH },
    vaultPath: vaultPath()
  });
}
