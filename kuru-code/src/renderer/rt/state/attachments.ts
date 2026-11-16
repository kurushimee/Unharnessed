import { PROVIDER_SEND_TURN_MAX_FILE_BYTES } from "~/contracts";

/**
 * The contract caps what a turn may reference, so a larger advertised value must not admit
 * files the send would then refuse.
 */
export function clampFileAttachmentUploadBytes(advertisedMaxUploadBytes: number): number {
  return Math.min(advertisedMaxUploadBytes, PROVIDER_SEND_TURN_MAX_FILE_BYTES);
}

export function formatAttachmentSize(sizeBytes: number): string {
  const kilobytes = Math.max(1, Math.ceil(sizeBytes / 1024));
  // Pick the unit after rounding, so 1023.5 KB reads "1.0 MB", not "1024 KB".
  return kilobytes >= 1024 ? `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB` : `${kilobytes} KB`;
}

export function fileAttachmentTooLargeMessage(name: string, maxUploadBytes: number): string {
  const maxUploadSize =
    maxUploadBytes >= 1024 * 1024 && maxUploadBytes % (1024 * 1024) === 0
      ? `${maxUploadBytes / (1024 * 1024)} MB`
      : maxUploadBytes >= 1024 && maxUploadBytes % 1024 === 0
        ? `${maxUploadBytes / 1024} KB`
        : `${maxUploadBytes} ${maxUploadBytes === 1 ? "byte" : "bytes"}`;
  return `'${name}' exceeds the ${maxUploadSize} attachment limit.`;
}
