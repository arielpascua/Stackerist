/**
 * The browser-facing services the UI needs besides CORE: device checks, the clipboard, the origin for
 * share links and a reload. Injected into <App>, so harnesses can replace each one.
 */
import { isApplePlatform, isTouchOnly, KeyboardProof, readPointerCapabilities } from './device.ts';

export interface DeviceServices {
  /** Touch-only right now (re-read on each check: a mouse can be plugged in). */
  readonly touchOnly: () => boolean;
  readonly keyboard: KeyboardProof;
  /** macOS / iOS: the legend shows Z only for rotate back. */
  readonly apple: boolean;
  readonly origin: string;
  readonly copyText: (text: string) => Promise<void>;
  readonly reload: () => void;
}

export function createBrowserDevice(win: Window): DeviceServices {
  return {
    touchOnly: () => isTouchOnly(readPointerCapabilities(win)),
    keyboard: new KeyboardProof(),
    apple: isApplePlatform(win.navigator.platform, win.navigator.userAgent),
    origin: win.location.origin,
    copyText: async (text) => {
      if (win.navigator.clipboard === undefined) throw new Error('Clipboard API unavailable');
      await win.navigator.clipboard.writeText(text);
    },
    reload: () => win.location.reload(),
  };
}
