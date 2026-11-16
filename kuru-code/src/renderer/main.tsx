// The window's entry, as T3 Code's main.tsx and appInit.tsx: its router on
// hash history (desktop), over kuru code's connection to its main process.
import "@fontsource-variable/inter";
import { createHashHistory, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_PREFS } from "@shared/protocol";
import { post } from "./bridge";
import { startMainAppLocationTracking } from "./components/sidebar/mainAppLocation";
import { getRouter } from "./router";
import { startKuru } from "./kuru/start";
import { applyTheme, connect } from "./state";
import "./index.css";

try {
  applyTheme(JSON.parse(localStorage.getItem("kuru:theme") ?? "null") ?? DEFAULT_PREFS.theme);
} catch {
  applyTheme(DEFAULT_PREFS.theme);
}
document.documentElement.classList.add("electron", "electron-windows", "wco");
connect();

const router = getRouter(createHashHistory());
startMainAppLocationTracking(router);
startKuru(router);

void router.load().then(() => {
  createRoot(document.getElementById("root")!, {
    onUncaughtError: (error, info) => {
      const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
      post({ type: "crashed", error: `${text}${info.componentStack ?? ""}` });
    },
  }).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
});
