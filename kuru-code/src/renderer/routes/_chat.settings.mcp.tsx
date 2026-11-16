import { createFileRoute } from "@tanstack/react-router";
import { McpSettingsPanel } from "../components/settings/McpSettingsPanel";

export const Route = createFileRoute("/_chat/settings/mcp")({ component: McpSettingsPanel });
