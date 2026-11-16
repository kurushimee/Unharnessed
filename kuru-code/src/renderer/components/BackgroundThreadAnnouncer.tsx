// From T3 Code's BackgroundThreadAnnouncer.tsx: the live region background
// threads' status changes are spoken through. kuru code tells of a thread that
// ends in the background with a toast, so nothing is spoken here yet.
import { createLiveRegion } from "../hooks/useLiveRegion";

const backgroundThreadLiveRegion = createLiveRegion();
const attachBackgroundThreadRegion = backgroundThreadLiveRegion.attach;

export function announceBackgroundThread(text: string): void {
  backgroundThreadLiveRegion.announce(text);
}

export function BackgroundThreadAnnouncer() {
  return <div ref={attachBackgroundThreadRegion} aria-live="polite" className="sr-only" />;
}
