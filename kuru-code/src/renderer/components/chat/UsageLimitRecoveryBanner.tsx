import { type TimestampFormat } from "~/contracts/settings";
import { GaugeIcon } from "lucide-react";
import { useState } from "react";
import { InlineButton } from "../ui/button";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { toastManager } from "../ui/toast";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

type RecoveryProps = {
  runId: string;
  resetAt: string | null;
  stoppedAt: string;
  settled: boolean;
  /** The thread goes on by itself once the limit resets. */
  autoResume: boolean;
  timestampFormat: TimestampFormat;
  onChange: (resume: boolean) => Promise<void>;
};

/** T3 Code's usage limit notice, without its snooze: Unharnessed threads are not snoozed. */
export function usageLimitRecoveryBannerItem(props: RecoveryProps): ComposerBannerStackItem {
  const { runId, resetAt, stoppedAt, settled, autoResume, timestampFormat } = props;
  const canSchedule = !settled && resetAt !== null && Date.parse(resetAt) > Date.parse(stoppedAt);
  const resumes = canSchedule && autoResume;
  const resetDescription = resetAt
    ? `${resumes ? "Resumes" : "Resets"} ${formatUpcomingTimestamp(resetAt, timestampFormat)}`
    : "Reset time unavailable; retry manually";
  return {
    id: `usage-limit-recovery:${runId}`,
    variant: "warning",
    group: "environment",
    icon: <GaugeIcon />,
    title: "Usage limit reached",
    description: resetDescription,
    actions: canSchedule ? <RecoveryActions key={`${runId}:${resetAt}`} {...props} /> : null,
  };
}

function RecoveryActions({ autoResume, onChange }: RecoveryProps) {
  const [pending, setPending] = useState(false);
  async function toggle() {
    setPending(true);
    try {
      await onChange(!autoResume);
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not change auto-resume",
        description: cause instanceof Error ? cause.message : "An error occurred.",
      });
    }
    setPending(false);
  }
  // Inline errors would widen the actions column and crush the title.
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
      <InlineButton touchTarget="padded" disabled={pending} onClick={() => void toggle()}>
        {pending ? "Saving..." : autoResume ? "Cancel auto-resume" : "Resume at reset"}
      </InlineButton>
    </span>
  );
}
