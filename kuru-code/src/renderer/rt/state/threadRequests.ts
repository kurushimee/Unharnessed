import type {
  OrchestrationV2ThreadProjection,
  OrchestrationV2RuntimeRequest,
  OrchestrationV2UserInputQuestion,
  ProviderApprovalFullAccessOverride,
  ProviderApprovalOption,
  ProviderRequestKind,
  RuntimeRequestId,
} from "~/contracts";
import { getProjectionArrayReplacementIndex } from "./orchestrationV2Projection";
import * as DateTime from "effect/DateTime";
import type { ThreadStructure, ThreadStructureVisibleTurnItem } from "./models";

export interface ThreadPendingApproval {
  readonly requestId: RuntimeRequestId;
  readonly requestKind: ProviderRequestKind;
  readonly createdAt: string;
  readonly detail?: string;
  readonly reason?: string;
  readonly fullAccessOverride?: ProviderApprovalFullAccessOverride;
  readonly appName?: string;
  readonly options?: ReadonlyArray<ProviderApprovalOption>;
  readonly responseCapability: "live" | "not_resumable";
  readonly supportsFeedback?: boolean;
}

export interface ThreadUserInputQuestion extends Omit<
  OrchestrationV2UserInputQuestion,
  "multiSelect"
> {
  readonly multiSelect: boolean;
}

export interface ThreadPendingUserInput {
  readonly requestId: RuntimeRequestId;
  readonly createdAt: string;
  readonly questions: ReadonlyArray<ThreadUserInputQuestion>;
  readonly responseCapability: OrchestrationV2RuntimeRequest["responseCapability"]["type"];
  readonly responseMode?: "message";
  readonly dismissible: boolean;
}

export interface PendingThreadRequests {
  readonly approvals: ReadonlyArray<ThreadPendingApproval>;
  readonly userInputs: ReadonlyArray<ThreadPendingUserInput>;
}

export function derivePendingThreadRequests(
  projection: Pick<ThreadStructure, "runtimeRequests" | "turnItems">,
): PendingThreadRequests {
  const approvals: ThreadPendingApproval[] = [];
  const userInputs: ThreadPendingUserInput[] = [];

  for (const request of projection.runtimeRequests) {
    if (request.status !== "pending") continue;
    const responseCapability = request.responseCapability.type;
    if (request.kind === "user_input") {
      const item = projection.turnItems.findLast(
        (candidate) =>
          candidate.type === "user_input_request" && candidate.requestId === request.id,
      );
      if (item === undefined || item.type !== "user_input_request") continue;
      userInputs.push({
        requestId: request.id,
        createdAt: DateTime.formatIso(request.createdAt),
        questions: item.questions.map((question) => ({
          ...question,
          multiSelect: question.multiSelect ?? false,
        })),
        responseCapability,
        dismissible: item.responseMode === "message" || responseCapability === "message",
        ...(item.responseMode === "message" || responseCapability === "message"
          ? { responseMode: "message" as const }
          : {}),
      });
      continue;
    }

    if (request.kind === "auth_refresh" || request.kind === "dynamic_tool_call") continue;
    const item = projection.turnItems.findLast(
      (candidate) => candidate.type === "approval_request" && candidate.requestId === request.id,
    );
    approvals.push({
      requestId: request.id,
      requestKind: request.kind,
      createdAt: DateTime.formatIso(request.createdAt),
      ...(item?.type === "approval_request" && item.prompt ? { detail: item.prompt } : {}),
      ...(item?.type === "approval_request" && item.reason ? { reason: item.reason } : {}),
      ...(item?.type === "approval_request" && item.fullAccessOverride
        ? { fullAccessOverride: item.fullAccessOverride }
        : {}),
      ...(item?.type === "approval_request" && item.appName ? { appName: item.appName } : {}),
      ...(item?.type === "approval_request" && item.options !== undefined
        ? { options: item.options }
        : {}),
      responseCapability: responseCapability === "live" ? "live" : "not_resumable",
      ...(request.responseCapability.type === "live" && request.responseCapability.supportsFeedback
        ? { supportsFeedback: true }
        : {}),
    });
  }

  return { approvals, userInputs };
}

export function createQuestionHistoryProjector<
  Row extends ThreadStructureVisibleTurnItem =
    OrchestrationV2ThreadProjection["visibleTurnItems"][number],
>() {
  type Rows = ReadonlyArray<Row>;
  type Requests = OrchestrationV2ThreadProjection["runtimeRequests"];
  let previousRows: Rows | undefined;
  let previousRequests: Requests | undefined;
  let previousResult: Rows | undefined;
  let byId = new Map<RuntimeRequestId, Requests[number]>();
  const cache = new WeakMap<Row, { request: Requests[number]; row: Row }>();
  const projectRow = (row: Row): Row => {
    const item = row.item;
    if (item.type !== "user_input_request" || item.questionAnswer) return row;
    const request = byId.get(item.requestId);
    if (request?.status !== "resolved" || request.answers === undefined) return row;
    const cached = cache.get(row);
    const next: Row =
      cached?.request === request
        ? cached.row
        : {
            ...row,
            item: {
              ...item,
              questionAnswer: {
                requestId: request.id,
                answers: request.answers,
                attachmentsByQuestionId: {},
                questionTextById: Object.fromEntries(
                  item.questions.map((question) => [question.id, question.question]),
                ),
              },
            },
          };
    cache.set(row, { request, row: next });
    return next;
  };
  const projectRows = (rows: Rows): Rows => {
    let result: Row[] | undefined;
    for (const [index, row] of rows.entries()) {
      const next = projectRow(row);
      if (next !== row) result ??= rows.slice(0, index);
      result?.push(next);
    }
    return result ?? rows;
  };
  return (projection: {
    readonly visibleTurnItems: Rows;
    readonly runtimeRequests: Requests;
  }): Rows => {
    const { visibleTurnItems: rows, runtimeRequests: requests } = projection;
    const sameRequests = requests === previousRequests;
    if (rows === previousRows && sameRequests && previousResult) return previousResult;
    if (!sameRequests) byId = new Map(requests.map((request) => [request.id, request]));
    // Nothing was overlaid and requests are unchanged, so only an exactly replaced row can differ.
    const replacedIndex =
      sameRequests && previousRows !== undefined && previousResult === previousRows
        ? getProjectionArrayReplacementIndex(previousRows, rows)
        : undefined;
    const unchanged =
      replacedIndex !== undefined && projectRow(rows[replacedIndex]!) === rows[replacedIndex];
    previousRows = rows;
    previousRequests = requests;
    previousResult = unchanged ? rows : projectRows(rows);
    return previousResult;
  };
}

