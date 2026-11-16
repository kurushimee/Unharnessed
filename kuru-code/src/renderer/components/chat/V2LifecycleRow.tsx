import { CircleAlertIcon, CircleStopIcon, InfoIcon } from "lucide-react";

import type { OrchestrationV2TurnItem } from "~/contracts";
import { TimelineSystemDivider } from "./TimelineSystemDivider";

/** The lines kuru code draws between turns: an interrupted run, a restart, the kernel coming back. */
export function V2LifecycleRow(props: { readonly item: OrchestrationV2TurnItem }) {
  const { item } = props;
  if (item.type === "system_notice") {
    return (
      <TimelineSystemDivider
        label={item.message}
        tone={item.status === "failed" ? "danger" : "neutral"}
        icon={item.status === "failed" ? CircleAlertIcon : InfoIcon}
        wrapDetail
      />
    );
  }
  if (item.type === "run_interrupt_result") {
    return (
      <TimelineSystemDivider
        label="Run interrupted"
        detail={item.message}
        icon={CircleStopIcon}
        wrapDetail
      />
    );
  }
  return null;
}
