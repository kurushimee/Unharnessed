// Adapted from T3 Code's types.ts: the app's names for its shells, and the
// chat's attachments.
import { imageMimeType } from "~/shared/image";
import { videoMimeType } from "~/shared/video";
import type {
  ChatFileAttachment as ContractChatFileAttachment,
  ChatImageAttachment as ContractChatImageAttachment,
  ChatUnknownAttachment as ContractChatUnknownAttachment,
} from "~/contracts";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
  ThreadRuntimeSummary,
} from "~/rt/state/models";

export type SessionPhase = "disconnected" | "connecting" | "ready" | "running";

export type Project = EnvironmentProject;
export type Thread = EnvironmentThreadShell;
export type ThreadShell = EnvironmentThreadShell;

export type SidebarThreadSummary = EnvironmentThreadShell;
export type ThreadSession = ThreadRuntimeSummary;

export { videoMimeType } from "~/shared/video";

export interface ChatImageAttachment extends ContractChatImageAttachment {
  readonly previewUrl?: string;
}

export interface ChatFileAttachment extends ContractChatFileAttachment {
  readonly previewUrl?: string;
  readonly downloadable?: boolean;
  readonly htmlRender?: boolean;
}

export type ChatUnknownAttachment = ContractChatUnknownAttachment;

export type ChatAttachment = ChatImageAttachment | ChatFileAttachment | ChatUnknownAttachment;

export function isImageAttachment(attachment: ChatAttachment): attachment is ChatImageAttachment {
  if (attachment.type === "image") return true;
  return attachment.type === "file" && imageMimeType(attachment) !== null;
}

export function isFileAttachment(attachment: ChatAttachment): attachment is ChatFileAttachment {
  return attachment.type === "file" && !isImageAttachment(attachment);
}

export function isVideoAttachment(attachment: ChatFileAttachment): boolean {
  return videoMimeType(attachment) !== null;
}
