/**
 * @file
 *
 * The screenshot capture's wall-clock budget, in one place.
 *
 * It lives here rather than in `scripts/vitest-config.ts` because BOTH ends need it: the config
 * declares it as the projects' `hookTimeout` / `testTimeout`, and the Android suite's index wait
 * sizes itself against it. While it was in the config alone the wait could only be sized by
 * hand-counting polls against a number copied out of another file - which is exactly how the wait
 * came to spend 590 s of the 600 s hook and leave the suite to die on a bare
 * `Hook timed out in 600000ms` with nothing said about the vault it was waiting for.
 *
 * A poll's cost is not a constant on a contended emulator, so a poll COUNT is not a budget. A
 * deadline is.
 */

/**
 * How long a capture hook or test may take.
 *
 * Far longer than the 30 s default, and specific to this plugin: the shots are taken in a vault of
 * hundreds of notes that Obsidian has to index before a single frame means anything, and on the
 * Android leg every one of those notes is pushed onto a device first.
 */
export const CAPTURE_HOOK_TIMEOUT_IN_MILLISECONDS = 600_000;

/**
 * How much of the hook the index wait leaves alone.
 *
 * Enough for the poll in flight when the deadline passes, plus the throw. The point is that the
 * wait's OWN error - which names the counts, the elapsed and the staging time - is what the reader
 * sees, rather than vitest's hook timeout, which names none of them.
 */
const CAPTURE_HOOK_RESERVE_IN_MILLISECONDS = 30_000;

/**
 * Works out when the index wait has to give up.
 *
 * @param hookStartedAtInMilliseconds - When the hook started, from `Date.now()`. Taken at the top of
 *   the hook rather than at the wait, so staging the vault - the step a contended machine makes ~50x
 *   slower - is spent out of the same budget instead of extending it.
 * @returns The `Date.now()` value the wait must not run past.
 */
export function computeCaptureDeadline(hookStartedAtInMilliseconds: number): number {
  return hookStartedAtInMilliseconds + CAPTURE_HOOK_TIMEOUT_IN_MILLISECONDS - CAPTURE_HOOK_RESERVE_IN_MILLISECONDS;
}
