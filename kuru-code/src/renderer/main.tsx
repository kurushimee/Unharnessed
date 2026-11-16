import "@fontsource-variable/inter";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { post } from "./bridge";
import { applyTheme, connect } from "./state";
import "./index.css";
import "./panel.css";
import { DEFAULT_PREFS } from "@shared/protocol";

// The theme before the first paint: the one saved last time.
try {
  applyTheme(JSON.parse(localStorage.getItem("kuru:theme") ?? "null") ?? DEFAULT_PREFS.theme);
} catch {
  applyTheme(DEFAULT_PREFS.theme);
}
document.documentElement.classList.add("electron", "electron-windows", "wco");
connect();

// A crash empties the window: what threw goes to the log.
createRoot(document.getElementById("root")!, {
  onUncaughtError: (error, info) => {
    const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
    post({ type: "crashed", error: `${text}${info.componentStack ?? ""}` });
  },
}).render(<App />);
