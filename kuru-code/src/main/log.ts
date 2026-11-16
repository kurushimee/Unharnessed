import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import type { LogOutputChannel } from "vscode";

/** Past this, the log moves to `main.old.log` and starts again. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * The app's log: one file in the user data folder (`logs/main.log`), and
 * the console in development. It has the shape of the VS Code log channel
 * the extension's modules write to.
 */
export function createLog(dir: string): LogOutputChannel & { file: string } {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "main.log");
  try {
    if (statSync(file).size > MAX_BYTES) renameSync(file, join(dir, "main.old.log"));
  } catch {
    // No log yet.
  }
  const write = (level: string, message: string | Error) => {
    const text = message instanceof Error ? (message.stack ?? message.message) : message;
    const line = `${new Date().toISOString()} [${level}] ${text}\n`;
    try {
      appendFileSync(file, line);
    } catch {
      // The log is best effort.
    }
    if (!process.env.KURU_QUIET) process.stdout.write(line);
  };
  return {
    file,
    info: (message: string) => write("info", message),
    warn: (message: string) => write("warn", message),
    error: (message: string | Error) => write("error", message),
  };
}

/** The log, each line marked with its thread: `[2] chat: turn 1 done`. */
export function tagged(log: LogOutputChannel, tag: number | string): LogOutputChannel {
  const mark = (line: string) => `[${tag}] ${line}`;
  return {
    info: (line: string) => log.info(mark(line)),
    warn: (line: string) => log.warn(mark(line)),
    error: (line: string | Error) => log.error(typeof line === "string" ? mark(line) : line),
  };
}
