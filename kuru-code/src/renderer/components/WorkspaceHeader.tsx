import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import { useSidebar } from "./ui/sidebar";

/**
 * T3 Code's page header: the window's draggable title bar, clear of the
 * sidebar's toggle while the sidebar is closed and of Windows' caption
 * buttons on the right.
 */
export function WorkspaceHeader({ children, className }: { children: ReactNode; className?: string }) {
  const { open, isMobile } = useSidebar();
  const besideToggle = !open || isMobile;
  return (
    <header
      className={cn(
        "drag-region relative z-10 flex h-[var(--workspace-topbar-height)] shrink-0 items-center gap-3 border-b border-border/60 pr-[calc(var(--workspace-native-controls-inset,0px)+0.5rem)] pl-[var(--workspace-gutter)]",
        besideToggle && "pl-[calc(var(--workspace-controls-left)+var(--workspace-titlebar-control-size)+0.75rem)]",
        className,
      )}
    >
      {children}
    </header>
  );
}
