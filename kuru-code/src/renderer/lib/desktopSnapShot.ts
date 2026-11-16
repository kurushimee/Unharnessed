// kuru code: T3 Code's desktop app captures the screen into the composer (Snap Shot); kuru code's window has no capture bridge.
import type { DesktopBridge } from "~/contracts";

export function getDesktopSnapShotBridge(): DesktopBridge | undefined {
  return undefined;
}

export function subscribeSnapShotComposerFocus(_listener: () => void): () => void {
  return () => undefined;
}
