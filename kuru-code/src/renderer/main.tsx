// The window's entry, as T3 Code's main.tsx and appInit.tsx: its router on
// hash history (desktop), over kuru code's connection to its main process.
import "@fontsource-variable/inter";
import { createHashHistory, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { post } from "./bridge";
import { startAppServices } from "./appInit";
import { getRouter } from "./router";
import { startKuru } from "./kuru/start";
import { connect } from "./state";
import "./index.css";

connect();

const router = getRouter(createHashHistory());
startAppServices(router);
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
