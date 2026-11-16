// Adapted from T3 Code's branding.ts: the app's name. kuru code is one
// build, so its name has no channel or stage.
import { formatAppDisplayName } from "./branding.logic";

export const HOSTED_APP_CHANNEL = null;
export const HOSTED_APP_CHANNEL_LABEL = null;
export const APP_BASE_NAME = "kuru code";
export const APP_STAGE_LABEL = "Latest";
export const APP_DISPLAY_NAME = formatAppDisplayName({
  baseName: APP_BASE_NAME,
  stageLabel: APP_STAGE_LABEL,
});
export const APP_VERSION = import.meta.env.APP_VERSION || "0.0.0";
