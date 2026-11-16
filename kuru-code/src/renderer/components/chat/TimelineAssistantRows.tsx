import { shouldPreserveAssistantLineBreaks } from "~/shared/markdownPipeline";
import { use } from "react";
import { type ChatMessage } from "../../types";
import ChatMarkdown from "../ChatMarkdown";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { useAssistantMessageText } from "../../state/entities";
import { MessageCopyButton } from "./MessageCopyButton";
import { AssistantCitationSource } from "./AssistantCitationSource";
import { resolveAssistantMessageCopyState } from "./MessagesTimeline.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "../../timestampFormat";
import { TimelineRowCtx, type TimelineRow } from "./timelineRowContext";
import { MESSAGE_HEADING_LEVEL, MessageAuthorHeading } from "./TimelineRowParts";

export function AssistantTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  const ctx = use(TimelineRowCtx);
  // The timeline holds a streaming message's row while only its text grows.
  const liveText = useAssistantMessageText(
    row.message.streaming ? ctx.threadRef : null,
    row.projectedItem?.item.id,
  );
  const text = liveText ?? row.message.text;
  const messageText =
    text || (row.message.streaming || row.suppressEmptyResponse ? "" : "(empty response)");

  return (
    <>
      <div className="relative min-w-0 px-1 py-0.5">
        <MessageAuthorHeading>Unharnessed</MessageAuthorHeading>
        <div data-thread-find-text="true">
          <AssistantCitationSource
            messageId={row.message.id}
            {...(ctx.threadRef ? { threadRef: ctx.threadRef } : {})}
            itemKey={row.id}
            request={ctx.citationRequest}
            listRef={ctx.listRef}
          >
            <ChatMarkdown
              text={messageText}
              cwd={ctx.markdownCwd}
              threadRef={ctx.threadRef ?? undefined}
              isStreaming={Boolean(row.message.streaming)}
              lineBreaks={shouldPreserveAssistantLineBreaks(messageText)}
              skills={ctx.skills}
              headingLevelOffset={MESSAGE_HEADING_LEVEL}
              onImageExpand={ctx.onImageExpand}
            />
          </AssistantCitationSource>
        </div>
        {row.showAssistantMeta ? (
          <AssistantMessageMeta
            className="mt-1.5"
            projectedItem={row.projectedItem}
            message={row.message}
            showCopyButton={row.showAssistantCopyButton}
            copyStreaming={row.assistantCopyStreaming}
          />
        ) : null}
      </div>
    </>
  );
}

export function AssistantMetaTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "assistant-meta" }>;
}) {
  return (
    <div className="px-1">
      <AssistantMessageMeta
        className="mt-0.5"
        projectedItem={row.projectedItem}
        message={row.message}
        showCopyButton={row.showAssistantCopyButton}
        copyStreaming={row.assistantCopyStreaming}
        alwaysVisible
      />
    </div>
  );
}

function AssistantMessageMeta({
  className,
  projectedItem,
  message,
  showCopyButton,
  copyStreaming,
  alwaysVisible = false,
}: {
  className?: string;
  projectedItem?: Extract<TimelineRow, { kind: "message" }>["projectedItem"];
  message: ChatMessage;
  showCopyButton: boolean;
  copyStreaming: boolean;
  alwaysVisible?: boolean;
}) {
  const ctx = use(TimelineRowCtx);

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs tabular-nums transition-opacity duration-200",
        alwaysVisible
          ? "opacity-100"
          : "opacity-0 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover/assistant:opacity-100",
        className,
      )}
    >
      {projectedItem && projectedItem.item.status !== "completed" ? (
        <span className="rounded-full border border-border/70 px-1.5 py-0.5 font-mono text-3xs text-muted-foreground">
          {projectedItem.item.status}
        </span>
      ) : null}
      <AssistantCopyButton
        message={message}
        showCopyButton={showCopyButton}
        streaming={copyStreaming}
      />
      {!message.streaming && (
        <Tooltip>
          <TooltipTrigger render={<p className="text-muted-foreground text-xs tabular-nums" />}>
            {formatDayAwareTimestamp(message.updatedAt, ctx.timestampFormat)}
          </TooltipTrigger>
          <TooltipPopup>
            {formatChatTimestampTooltip(message.updatedAt, ctx.timestampFormat)}
          </TooltipPopup>
        </Tooltip>
      )}
    </div>
  );
}

function AssistantCopyButton({
  message,
  showCopyButton,
  streaming,
}: {
  message: ChatMessage;
  showCopyButton: boolean;
  streaming: boolean;
}) {
  const assistantCopyState = resolveAssistantMessageCopyState({
    text: message.text ?? null,
    showCopyButton,
    streaming,
  });

  if (!assistantCopyState.visible) {
    return null;
  }

  return <MessageCopyButton text={assistantCopyState.text ?? ""} variant="ghost" />;
}

export function ProposedPlanTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "proposed-plan" }>;
}) {
  const ctx = use(TimelineRowCtx);

  return (
    <div className="min-w-0 px-1 py-0.5">
      <ProposedPlanCard
        planMarkdown={row.proposedPlan.planMarkdown}
        environmentId={ctx.activeThreadEnvironmentId}
        threadRef={ctx.threadRef ?? undefined}
        cwd={ctx.markdownCwd}
        workspaceRoot={ctx.workspaceRoot}
        findActive={ctx.findActive}
      />
    </div>
  );
}
