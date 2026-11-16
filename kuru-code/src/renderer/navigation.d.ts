// The Navigation API (Chromium), which T3 Code's history buttons read.
interface NavigationLike extends EventTarget {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

/** The part of T3 Code's desktop bridge kuru code's preload gives (main/preload.ts). */
interface DesktopBridge {
  /** Sets the window's native theme (its title bar buttons), as T3 Code's desktop app does. */
  setTheme(theme: "light" | "dark" | "system"): Promise<void>;
  /** Reads http(s) media in the main process, outside the window's CORS; null on network failure. */
  readMedia(url: string): Promise<{ status: number; mimeType: string; data: Uint8Array } | null>;
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
