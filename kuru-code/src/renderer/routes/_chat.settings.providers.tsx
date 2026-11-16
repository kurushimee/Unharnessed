import { createFileRoute } from "@tanstack/react-router";
import { ProvidersSettingsPanel } from "../components/settings/ProvidersSettingsPanel";

export const Route = createFileRoute("/_chat/settings/providers")({ component: ProvidersSettingsPanel });
