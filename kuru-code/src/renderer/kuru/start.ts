// What kuru code starts beside T3 Code's interface, for the window's life: the
// shells, thread projections and providers T3 Code's screens read, built from
// the main process's state; and the route's thread kept on screen in the main
// process (each Unharnessed thread runs in an agent of its own there, and the
// one on screen is the one whose conversation streams to the window).
import type { AnyRouter } from "@tanstack/react-router";
import { invoke, post } from "~/bridge";
import { useComposerDraftStore, type DraftId } from "~/composerDraftStore";
import { useStore } from "~/state";
import { resolveThreadRouteTarget } from "~/threadRoutes";
import { appProjectIdOf, startShellAtoms } from "./shells";
import { startThreadDetails } from "./threadDetails";
import { startProviders } from "./providers";

function followRoute(router: AnyRouter): void {
  let last: string | null = null;
  const sync = () => {
    const params = (router.state.matches.at(-1)?.params ?? {}) as Record<string, string | undefined>;
    const target = resolveThreadRouteTarget(params);
    if (target === null) return;
    const shown = useStore.getState().app?.shown;
    if (target.kind === "server") {
      const id = target.threadRef.threadId;
      if (last === id) return;
      last = id;
      if (shown?.id !== id) void invoke("threads.open", { id });
      return;
    }
    const draft = useComposerDraftStore.getState().getDraftSession(target.draftId as DraftId);
    const key = `draft:${target.draftId}`;
    if (last === key || draft === null) return;
    last = key;
    // A new thread opens on an empty conversation in its project's folder.
    const projectId = appProjectIdOf(draft.projectId);
    if (!shown?.draft || shown.projectId !== projectId) {
      post({ type: "newChat", draft: { text: "", images: [] }, projectId } as never);
    }
  };
  router.subscribe("onResolved", sync);
  sync();
}

export function startKuru(router: AnyRouter): void {
  startShellAtoms();
  startThreadDetails();
  startProviders();
  followRoute(router);
}
