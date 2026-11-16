import { useEffect } from "react";
import { SignIn } from "@panel/SignIn";
import { post } from "./bridge";
import { AppSidebar, openThread } from "./components/AppSidebar";
import { ConfirmHost } from "./components/confirm";
import { PullRequestsPage } from "./components/PullRequestsPage";
import { SettingsPage } from "./components/SettingsPage";
import { ThreadView } from "./components/ThreadView";
import { ToolPartDialog } from "./components/ToolPartDialog";
import { UsagePage } from "./components/UsagePage";
import { Dialog, DialogPopup } from "./components/ui/dialog";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "./components/ui/sidebar";
import { toastManager, ToastProvider } from "./components/ui/toast";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { cn } from "./lib/utils";
import { get, set, useStore } from "./state";

export function App() {
  const main = useStore((state) => state.main);
  const settingsOpen = useStore((state) => state.settingsOpen);
  const usageOpen = useStore((state) => state.usageOpen);
  const login = useStore((state) => state.login);
  const agent = useStore((state) => state.agent);
  const done = useStore((state) => state.done);

  // A thread that ended in the background: a toast that opens it.
  useEffect(() => {
    if (done.length === 0) return;
    for (const item of done) {
      toastManager.add({
        type: item.failed ? "error" : "success",
        title: item.failed ? "Thread failed" : "Thread finished",
        description: item.title ?? "A thread finished.",
        actionProps: { children: "Open", onClick: () => openThread(item.id) },
      });
    }
    set({ done: [] });
  }, [done]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        set({ settingsOpen: get().settingsOpen ? null : "general" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const screen = login ? "login" : settingsOpen ? "settings" : usageOpen ? "usage" : main.kind === "prs" ? "prs" : "status";
    post({ type: "screen", screen: screen as never });
  }, [login, settingsOpen, usageOpen, main.kind]);

  return (
    <TooltipProvider delay={400}>
      <ToastProvider position="bottom-right">
        <SidebarProvider className="h-dvh! min-h-0!" storageKey="kuru:sidebarOpen">
          <AppSidebar />
          <SidebarInset className="min-h-0 overflow-hidden">
            {settingsOpen ? <SettingsPage section={settingsOpen} /> : usageOpen ? <UsagePage /> : main.kind === "prs" ? <PullRequestsPage /> : <ThreadView />}
          </SidebarInset>
          <SidebarControl />
        </SidebarProvider>
        <Dialog open={!!login && agent?.kind === "ready"} onOpenChange={(open) => !open && post({ type: "loginCancel" })}>
          <DialogPopup className="h-[min(40rem,85vh)] max-w-lg overflow-hidden p-0" showCloseButton={false}>{login ? <SignIn login={login} /> : null}</DialogPopup>
        </Dialog>
        <ToolPartDialog />
        <ConfirmHost />
      </ToastProvider>
    </TooltipProvider>
  );
}

/** T3 Code's sidebar toggle, fixed at the window's top left. */
function SidebarControl() {
  const { toggleSidebar } = useSidebar();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "b") {
        if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);
  return (
    <div className={cn("pointer-events-none fixed top-[var(--workspace-controls-top)] left-[var(--workspace-controls-left)] z-50 ml-px flex h-[var(--workspace-topbar-height)] items-center")}>
      <Tooltip>
        <TooltipTrigger render={<SidebarTrigger className="pointer-events-auto" aria-label="Toggle main sidebar" />} />
        <TooltipPopup side="bottom">Toggle main sidebar (Ctrl+B)</TooltipPopup>
      </Tooltip>
    </div>
  );
}
