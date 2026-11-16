// T3 Code's state/preview.ts: its server runs browser previews of a thread's
// pages and files. kuru code has no preview browser: its main process
// answers the request as unavailable, and links open outside the app.
import { WS_METHODS } from "~/contracts";
import { createLocalRpcCommand } from "~/rt/state/runtime";

export const previewEnvironment = {
  open: createLocalRpcCommand({
    label: "environment-data:preview:open",
    tag: WS_METHODS.previewOpen,
  }),
};
