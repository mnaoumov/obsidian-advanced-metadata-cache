import { wrapCliTask } from 'obsidian-dev-utils/script-utils/cli-utils';
import { test } from 'obsidian-dev-utils/script-utils/test-runners/vitest';

import { assertNoForeignEmulator } from './helpers/android-emulator-contention.ts';
import { SCREENSHOT_AVD_NAME } from './helpers/screenshot-avd.ts';

// Desktop first, then Android — the two share one machine, and the Android leg
// boots an emulator, so running them concurrently would collide on the device.
await wrapCliTask(async () => {
  /*
   * Refused BEFORE the desktop leg rather than between the two, because the set is captured as a
   * whole: spending minutes on the desktop frames only to then refuse the mobile ones leaves a
   * half-set, which is the state the last re-capture had to be rescued from. Costs one
   * `adb devices` when the machine is quiet.
   *
   * The Android suite runs the same check in its own `beforeAll`, and that one is the authoritative
   * one: it also covers a direct `--project capture-screenshots:android` run, and an emulator can
   * appear on the machine during the desktop leg.
   */
  await assertNoForeignEmulator(SCREENSHOT_AVD_NAME);

  await test({
    projects: ['capture-screenshots:desktop']
  });
  await test({
    projects: ['capture-screenshots:android']
  });
});
