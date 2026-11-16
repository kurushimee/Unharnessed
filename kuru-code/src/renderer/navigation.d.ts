// The Navigation API (Chromium), which T3 Code's history buttons read.
interface NavigationLike extends EventTarget {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

/** The part of T3 Code's desktop bridge kuru code's preload gives (main/preload.ts). */
interface DesktopBridge {
  /** A menu or main-process action by name (T3 Code's menu actions). */
  onMenuAction(listener: (action: string) => void): () => void;
  onTrackpadScrollBegin?(listener: () => void): () => void;
  onTrackpadScrollEnd?(listener: () => void): () => void;
  /** macOS only in T3 Code; kuru code runs on Windows, so these stay unset. */
  getWindowFullscreenState?(): boolean;
  onWindowFullscreenStateChange?(listener: (fullscreen: boolean) => void): () => void;
}

interface Window {
  readonly navigation: NavigationLike;
  readonly desktopBridge?: DesktopBridge;
}
