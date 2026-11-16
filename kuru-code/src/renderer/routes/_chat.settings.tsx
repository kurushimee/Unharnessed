// Adapted from T3 Code's routes/_chat.settings.tsx: the settings modal, its sidebar of
// pages and the page shown. kuru code has one environment, so T3 Code's settings
// scopes (environment, project, checkout) and their notices are not part of it.
import { workspaceAreaProps } from "../lib/workspaceFocus";
import { Outlet, createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { RotateCcwIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { useSettingsRestore } from "../components/settings/SettingsPanels";

import { AppRouteModal, AppRouteModalClose } from "../components/AppRouteModal";
import { SettingsBreadcrumb } from "../components/settings/SettingsBreadcrumb";
import { SettingsSidebarNav } from "../components/settings/SettingsSidebarNav";
import { ProviderSignInDialog } from "../components/settings/ProviderSignInDialog";

function RestoreDeviceDefaultsButton({ onRestored }: { onRestored: () => void }) {
  const { changedSettingLabels, restoreDefaults } = useSettingsRestore(onRestored);
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={changedSettingLabels.length === 0}
      onClick={() => void restoreDefaults()}
    >
      <RotateCcwIcon className="mx-1 size-3.5" />
      <span className="max-sm:sr-only">Restore defaults</span>
    </Button>
  );
}

function SettingsRouteLayout() {
  const contentArea = workspaceAreaProps("settings", 1, "Settings content");
  const location = useLocation();
  const [restoreSignal, setRestoreSignal] = useState(0);

  return (
    <AppRouteModal label="Settings">
      <div className="relative flex min-h-0 flex-1">
        <SettingsSidebarNav pathname={location.pathname} />
        <div {...contentArea} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b ps-5 pe-2">
            <SettingsBreadcrumb pathname={location.pathname} />
            <div className="ms-auto flex shrink-0 items-center gap-1">
              {location.pathname === "/settings/general" ? (
                <RestoreDeviceDefaultsButton
                  onRestored={() => setRestoreSignal((value) => value + 1)}
                />
              ) : null}
              <AppRouteModalClose />
            </div>
          </header>
          <div key={restoreSignal} className="min-h-0 flex flex-1 flex-col">
            <Outlet />
          </div>
        </div>
      </div>
      <ProviderSignInDialog />
    </AppRouteModal>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/settings") {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsRouteLayout,
});
