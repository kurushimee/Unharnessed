// Adapted from T3 Code's appInit.tsx: the services that run for the window's whole
// life, started once before the first render. kuru code keeps the appearance,
// theme, overlay retention and workspace focus services; T3 Code's remote,
// browser, preview, update and device services are not part of it.
import { scopedThreadKey, scopeThreadRef } from "~/rt/environment";
import type { ClientSettings } from "~/contracts/settings";
import type { AnyRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { applyAppearanceContrast } from "./appearanceContrast";
import { applyAppearanceFontVariables, TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "./appearanceFonts";
import { retainThreadOverlaysForThread } from "./components/chat/threadOverlayRetention";
import { startMainAppLocationTracking } from "./components/sidebar/mainAppLocation";
import { useComposerDraftStore } from "./composerDraftStore";
import { readLocalStorageValue, subscribeLocalStorageKey } from "./hooks/useLocalStorage";
import { getClientSettings, subscribeClientSettings } from "./hooks/useSettings";
import { syncBrowserChromeTheme } from "./hooks/useTheme";
import {
  syncDocumentElectronPlatformClasses,
  syncDocumentWindowControlsOverlayClass,
} from "./lib/windowControlsOverlay";
import { startWorkspaceFocus } from "./lib/workspaceFocus";
import { resolveThreadRouteTarget } from "./threadRoutes";

/** Writes appearance settings onto the document, touching only the groups that changed. */
function startClientAppearance(): void {
  const root = document.documentElement;
  let applied: ClientSettings | null = null;
  let appliedSeparateFonts: boolean | null = null;
  const apply = () => {
    const settings = getClientSettings();
    const previous = applied;
    applied = settings;
    const separateFonts = readLocalStorageValue(
      TYPOGRAPHY_ADVANCED_STORAGE_KEY,
      false,
      Schema.Boolean,
    );
    const previousSeparateFonts = appliedSeparateFonts;
    appliedSeparateFonts = separateFonts;
    if (previous?.diffColorScheme !== settings.diffColorScheme) {
      root.dataset.diffColorScheme = settings.diffColorScheme;
    }
    if (previous?.chatWidth !== settings.chatWidth) {
      root.dataset.chatWidth = settings.chatWidth;
    }
    if (previous?.appearanceContrast !== settings.appearanceContrast) {
      applyAppearanceContrast(root, settings.appearanceContrast);
    }
    if (previous?.glassOpacity !== settings.glassOpacity) {
      root.style.setProperty("--glass-opacity", `${settings.glassOpacity}%`);
      if (settings.glassOpacity === 100) {
        root.style.setProperty("--glass-blur", "0px");
      } else {
        root.style.removeProperty("--glass-blur");
      }
    }
    if (
      previous?.fontFamilySans !== settings.fontFamilySans ||
      previous.fontFamilyCode !== settings.fontFamilyCode ||
      previous.fontFamilyComposer !== settings.fontFamilyComposer ||
      previous.fontSizeInterface !== settings.fontSizeInterface ||
      previous.fontSizePrompt !== settings.fontSizePrompt ||
      previous.fontSizeCode !== settings.fontSizeCode ||
      previous.fontSmoothing !== settings.fontSmoothing ||
      previousSeparateFonts !== separateFonts
    ) {
      applyAppearanceFontVariables(root, {
        sans: settings.fontFamilySans,
        code: settings.fontFamilyCode,
        composer: settings.fontFamilyComposer,
        sizeInterface: settings.fontSizeInterface,
        sizePrompt: settings.fontSizePrompt,
        sizeCode: settings.fontSizeCode,
        smoothing: settings.fontSmoothing,
        separate: separateFonts,
      });
    }
  };
  subscribeClientSettings(apply);
  subscribeLocalStorageKey(TYPOGRAPHY_ADVANCED_STORAGE_KEY, apply);
  apply();
}

/**
 * Each route paints its own surface, which the browser chrome samples once it is on screen.
 * onRendered only fires for a new href; onResolved also covers `router.invalidate()`, which
 * can swap the root between the bare outlet and the shell at the same address.
 */
function startBrowserChromeThemeSync(router: AnyRouter): void {
  const resync = () => window.requestAnimationFrame(syncBrowserChromeTheme);
  router.subscribe("onRendered", resync);
  router.subscribe("onResolved", resync);
}

/** Chat overlays belong to the thread they were opened in, so leaving its route drops them. */
function startThreadOverlayRetention(router: AnyRouter): void {
  router.subscribe("onResolved", () => {
    const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
    const draftSession =
      target?.kind === "draft"
        ? useComposerDraftStore.getState().getDraftSession(target.draftId)
        : null;
    const threadRef =
      target?.kind === "server"
        ? target.threadRef
        : draftSession
          ? scopeThreadRef(draftSession.environmentId, draftSession.threadId)
          : null;
    retainThreadOverlaysForThread(threadRef ? scopedThreadKey(threadRef) : null);
  });
}

/** Starts every app-lifetime service once, before the first render. */
export function startAppServices(router: AnyRouter): void {
  syncDocumentElectronPlatformClasses(navigator.platform);
  syncDocumentWindowControlsOverlayClass();

  startClientAppearance();
  startBrowserChromeThemeSync(router);
  startThreadOverlayRetention(router);
  startMainAppLocationTracking(router);
  startWorkspaceFocus(router);
}
