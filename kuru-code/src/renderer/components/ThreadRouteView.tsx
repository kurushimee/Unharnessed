// Adapted from T3 Code's ThreadRouteView.tsx: the thread a route names, in
// the _chat layout. The thread's own view (ChatView) is being ported; until
// then this shows the route's empty page.
import { SidebarInset } from "./ui/sidebar";
import { WorkspacePageHeader } from "./WorkspacePageHeader";
import type { ThreadRouteTarget } from "../threadRoutes";

export function ThreadRouteView({
  target: _target,
  background = false,
}: {
  target: ThreadRouteTarget;
  background?: boolean;
}) {
  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh" inert={background}>
      <WorkspacePageHeader electron />
    </SidebarInset>
  );
}
