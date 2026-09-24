/**
 * @file
 *
 * Refuses an Android capture run while a foreign emulator is up.
 *
 * Measured 2026-09-23, twice, three minutes apart, on the same code: with another project's
 * emulator on the machine the archive extract onto the device took **11.2 s** and the index wait
 * polled 134 times without ever settling, so the suite died on a bare `Hook timed out in 600000ms`
 * having written no frame; with the machine to itself the same extract took **0.2 s**, the wait
 * settled at once and all four frames were written. 802 s against 138 s, and the difference was the
 * host rather than anything in the suite.
 *
 * Capturing is an explicit operation rather than something a test run does, so refusing is a
 * legitimate answer to that: a second of `adb` here replaces thirteen minutes that produce nothing.
 * The check is deliberately narrow - it reports a contended machine, it does not try to fix one,
 * and it never blocks a run on its own inability to ask.
 */

import { exec } from 'obsidian-dev-utils/script-utils/exec';

/**
 * An emulator `adb` can see, and the AVD it is running.
 */
export interface AttachedEmulator {
  /**
   * The AVD's name, as the emulator console reports it.
   */
  readonly avdName: string;

  /**
   * The `adb` serial, e.g. `emulator-5554`.
   */
  readonly serial: string;
}

/**
 * The only `adb devices` state in which a device is actually running, and therefore actually costing
 * the machine something. `offline` and `unauthorized` entries are ignored.
 */
const ATTACHED_DEVICE_STATE = 'device';

/**
 * The line `adb devices` leads with, which carries no device.
 */
const DEVICE_LIST_HEADER_PREFIX = 'List of devices';

/**
 * What `adb emu` appends to every answer.
 */
const EMULATOR_CONSOLE_OK_LINE = 'OK';

/**
 * What every emulator's `adb` serial begins with.
 *
 * A physical device attached over USB is deliberately NOT contention: it has its own CPU and its own
 * storage, and it competes with the capture for nothing.
 */
const EMULATOR_SERIAL_PREFIX = 'emulator-';

/**
 * How many fields of an `adb devices` line are read: the serial and the state. Everything after them
 * is the `-l` detail, which this has no use for and which must not be split into.
 */
const SERIAL_AND_STATE_FIELD_COUNT = 2;

/**
 * Throws when a foreign emulator is up, so an explicit capture refuses instead of flaking.
 *
 * @param ownAvdName - The AVD this capture runs on. An emulator running it is the capture's own and
 *   is never contention, whether this run booted it or a previous one left it up.
 * @returns A {@link Promise} that resolves when the machine is the capture's to use.
 */
export async function assertNoForeignEmulator(ownAvdName: string): Promise<void> {
  const foreignEmulators = await findForeignEmulators(ownAvdName);
  if (foreignEmulators.length === 0) {
    return;
  }

  throw new Error(buildForeignEmulatorRefusal(foreignEmulators, ownAvdName));
}

/**
 * Writes the refusal a contended machine earns.
 *
 * Split out of {@link assertNoForeignEmulator} because the message IS the product of this preflight,
 * and it is the only part of it that can be read back without an emulator on the machine.
 *
 * @param foreignEmulators - The emulators that are not the capture's own. Never empty.
 * @param ownAvdName - The AVD this capture runs on, named so the refusal cannot be misread as being
 *   about the capture's own device.
 * @returns The message.
 */
export function buildForeignEmulatorRefusal(foreignEmulators: readonly AttachedEmulator[], ownAvdName: string): string {
  const listed = foreignEmulators
    .map((emulator) => `${emulator.serial} (${emulator.avdName})`)
    .join(', ');
  const killLines = foreignEmulators
    .map((emulator) => `  adb -s ${emulator.serial} emu kill`)
    .join('\n');

  return [
    `Refusing to capture: another emulator is on this machine - ${listed}.`,
    '',
    'Measured 2026-09-23: a capture started beside a foreign emulator staged its vault ~50x slower,',
    'never settled inside the 600 s hook, and produced no frame after 13 minutes. Whatever owns that',
    'emulator is mid-run too, so the honest answer is to wait for it rather than to race it.',
    '',
    'Wait for it to finish, or stop it:',
    killLines,
    '',
    `Then capture again. The capture's own AVD (${ownAvdName}) is never what this refuses on.`
  ].join('\n');
}

/**
 * Lists the emulators up on this machine that are NOT the capture's own.
 *
 * @param ownAvdName - The AVD this capture runs on.
 * @returns The foreign emulators, empty when the machine is quiet.
 */
export async function findForeignEmulators(ownAvdName: string): Promise<AttachedEmulator[]> {
  const attachedEmulators = await listAttachedEmulators();
  return attachedEmulators.filter((emulator) => emulator.avdName !== ownAvdName);
}

/**
 * Asks `adb` which emulators are up, and which AVD each is running.
 *
 * An `adb` that is missing or refuses to answer reports NO emulators rather than throwing: not being
 * able to ask is not evidence of contention, and a capture must not be stopped by its own preflight
 * failing. A genuinely broken `adb` fails loudly enough at the transport a minute later.
 *
 * @returns Every attached emulator, with its AVD name.
 */
export async function listAttachedEmulators(): Promise<AttachedEmulator[]> {
  const devicesOutput = await runAdb(['devices']);
  if (devicesOutput === null) {
    return [];
  }

  const attachedEmulators: AttachedEmulator[] = [];
  for (const serial of parseEmulatorSerials(devicesOutput)) {
    const avdNameOutput = await runAdb(['-s', serial, 'emu', 'avd', 'name']);
    // An emulator that will not name its AVD still costs the machine what it costs, so it counts -
    // under its serial, which is enough for the reader to find it.
    attachedEmulators.push({
      avdName: avdNameOutput === null ? serial : parseAvdName(avdNameOutput),
      serial
    });
  }

  return attachedEmulators;
}

/**
 * Reads the AVD name out of what `adb emu avd name` printed.
 *
 * The emulator console answers with the name, and then an `OK` acknowledgement on its own line.
 *
 * @param emuAvdNameOutput - The command's standard output.
 * @returns The AVD's name, or an empty string when the console said nothing but `OK`.
 */
export function parseAvdName(emuAvdNameOutput: string): string {
  return emuAvdNameOutput
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '' && line !== EMULATOR_CONSOLE_OK_LINE)
    ?? '';
}

/**
 * Reads the running emulators' serials out of what `adb devices` printed.
 *
 * @param adbDevicesOutput - The command's standard output.
 * @returns One serial per emulator that is up, in the order `adb` listed them.
 */
export function parseEmulatorSerials(adbDevicesOutput: string): string[] {
  const serials: string[] = [];
  for (const rawLine of adbDevicesOutput.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith(DEVICE_LIST_HEADER_PREFIX)) {
      continue;
    }

    const [serial, state] = line.split(/\s+/u, SERIAL_AND_STATE_FIELD_COUNT);
    if (serial?.startsWith(EMULATOR_SERIAL_PREFIX) && state === ATTACHED_DEVICE_STATE) {
      serials.push(serial);
    }
  }

  return serials;
}

/**
 * Runs an `adb` command, swallowing every way it can fail to answer.
 *
 * @param adbArguments - The arguments after `adb`.
 * @returns The command's standard output, or `null` when `adb` could not be asked.
 */
async function runAdb(adbArguments: string[]): Promise<null | string> {
  try {
    const result = await exec(['adb', ...adbArguments], {
      isQuiet: true,
      shouldIgnoreExitCode: true,
      shouldIncludeDetails: true
    });
    return result.exitCode === 0 ? result.stdout : null;
  } catch (error) {
    console.warn('The emulator-contention preflight could not run `adb`, so it is reporting a quiet machine.', { adbArguments, error });
    return null;
  }
}
