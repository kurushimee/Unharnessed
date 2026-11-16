// What kuru code's root mounts beside T3 Code's: the toasts for threads that
// end in the background, and the provider sign-in the agent runs.
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LOCAL_ENVIRONMENT_ID } from "~/contracts";
import { set, useStore } from "~/state";
import { toastManager } from "./ui/toast";

export function KuruHosts() {
  const done = useStore((state) => state.done);
  const navigate = useNavigate();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- turns the main process's thread endings into toasts
  useEffect(() => {
    if (done.length === 0) return;
    for (const item of done) {
      toastManager.add({
        type: item.failed ? "error" : "success",
        title: item.failed ? "Thread failed" : "Thread finished",
        description: item.title ?? "A thread finished.",
        actionProps: {
          children: "Open",
          onClick: () =>
            void navigate({
              to: "/$environmentId/$threadId",
              params: { environmentId: LOCAL_ENVIRONMENT_ID, threadId: item.id as never },
            }),
        },
      });
    }
    set({ done: [] });
  }, [done, navigate]);
  return null;
}
