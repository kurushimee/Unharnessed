import { createFileRoute } from "@tanstack/react-router";
import { InstructionsSettingsPanel } from "../components/settings/InstructionsSettingsPanel";

export const Route = createFileRoute("/_chat/settings/instructions")({ component: InstructionsSettingsPanel });
