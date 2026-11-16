import { V2LifecycleRow } from "./V2LifecycleRow";
import type { TimelineRow } from "./timelineRowContext";

export function V2EventTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "event" }> }) {
  return <V2LifecycleRow item={row.projectedItem.item} />;
}
