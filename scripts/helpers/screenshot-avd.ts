/**
 * @file
 *
 * The AVD the mobile store shots are taken on, and how it was provisioned.
 *
 * Shared rather than declared in `scripts/vitest-config.ts`, because three places have to agree on
 * it: the config points the transport at it, and both the capture script and the Android capture
 * suite name it when refusing a contended machine - a preflight that refused on the capture's OWN
 * emulator would refuse every capture there is.
 */

/**
 * The AVD the mobile shots are taken on: 900x1600 at density 320, which is
 * exactly the size the community store asks for, so the capture needs no crop,
 * no rescale and no letterbox. The shared `obsidian_test` AVD is a Pixel 10 Pro
 * XL at 1344x2994 (~9:20) and cannot produce it; resizing that one at runtime
 * destroys the Appium session, because the display change recreates the
 * activity and with it the WebView the session is attached to.
 *
 * Needs one-time provisioning, and all three steps are non-obvious. Steps 2
 * and 3 were re-measured on the shared `obsidian_test` AVD on 2026-09-23,
 * after a wipe took Obsidian off it and every Android suite on the machine
 * failed at setup; both are corrected here against what that re-provisioning
 * actually took.
 *
 * 1. The harness never installs the Obsidian APK. It launches the emulator and
 *    starts `md.obsidian`, so a fresh AVD fails with `Activity class
 *    {md.obsidian/md.obsidian.MainActivity} does not exist`. Nothing here
 *    downloads that APK either: pull it off an AVD that still has one, with
 *    `adb shell pm path md.obsidian` and then `adb pull`.
 * 2. An install persists only when it is made in a COLD-BOOTED session and
 *    flushed before shutdown. Installing into a snapshot-LOADED session, and
 *    installing without a flush, both reported `Success` and both were gone on
 *    the next boot: the write lands in the quickboot snapshot, and the harness
 *    always boots `-no-snapshot-load`, which reverts to the base userdata
 *    image. What held: boot `-no-snapshot-load`, `adb install`, `adb shell
 *    sync`, then `adb emu kill`. The package then survived both a hand cold
 *    boot and the harness's own.
 * 3. Obsidian's first-run onboarding has to be completed by hand once, and it
 *    is four screens rather than one: `Create a vault`, `Continue without
 *    sync`, name it leaving `Device storage` selected, then `Allow file
 *    access` - which opens a SAF folder picker that has to be pointed at
 *    `/sdcard/Documents`, the harness's `DEFAULT_ANDROID_VAULT_BASE_PATH`.
 *    Granting `appops set md.obsidian MANAGE_EXTERNAL_STORAGE allow`
 *    beforehand skips none of it, and neither does `adb install -g`. Until
 *    someone taps through, the app sits on its welcome screen and setup fails
 *    after the FULL timeout - reported as the WebView answering while
 *    `globalThis.app` never appears, NOT as a layout-ready timeout, so the
 *    startup phase the error names is how this is told apart from a slow app.
 */
export const SCREENSHOT_AVD_NAME = 'obsidian_screenshots';
