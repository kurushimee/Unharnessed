// Shared across hook instances so sidebar, header and menu actions invalidate each other.
const currentActions = new Map<string, symbol>();
const listeners = new Set<() => void>();

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

export function begin(kind: string, threadKey: string) {
  const key = JSON.stringify([kind, threadKey]);
  const token = Symbol();
  currentActions.set(key, token);
  notify();
  const isCurrent = () => currentActions.get(key) === token;
  return {
    isCurrent,
    finish: () => {
      if (isCurrent()) {
        currentActions.delete(key);
        notify();
      }
    },
  };
}

export function invalidate(kind: string, threadKey: string) {
  currentActions.delete(JSON.stringify([kind, threadKey]));
  notify();
}

export type ThreadUndoStep =
  | { readonly action: "unsettle" }
  | { readonly action: "pin"; readonly orderKey?: string };

export type ThreadUndoPlan = readonly [ThreadUndoStep, ...ThreadUndoStep[]];

export function planThreadUndo(
  action: "settle" | "unpin",
  thread?: {
    readonly pinnedAt?: string | null;
    readonly pinOrderKey?: string | null;
  } | null,
): ThreadUndoPlan {
  const pin: ThreadUndoStep = {
    action: "pin",
    ...(thread?.pinOrderKey != null ? { orderKey: thread.pinOrderKey } : {}),
  };
  if (action === "unpin") return [pin];
  return [{ action: "unsettle" }, ...(thread?.pinnedAt != null ? [pin] : [])];
}

export async function executeThreadUndo<Result>(
  plan: ThreadUndoPlan,
  execute: (step: ThreadUndoStep) => Promise<Result>,
  succeeded: (result: Result) => boolean,
): Promise<Result> {
  let result = await execute(plan[0]);
  for (const step of plan.slice(1)) {
    if (!succeeded(result)) return result;
    result = await execute(step);
  }
  return result;
}
