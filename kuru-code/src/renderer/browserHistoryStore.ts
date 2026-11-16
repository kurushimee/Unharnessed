// T3 Code's browserHistoryStore.ts keeps the pages its preview browser opened
// for a thread. kuru code opens links in the system browser and keeps none.
import type { ScopedThreadRef } from "~/contracts";

export function recordVisitForThread(_ref: ScopedThreadRef, _url: string, _title?: string): void {}
