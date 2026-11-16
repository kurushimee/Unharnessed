// kuru code: from T3 Code's environments/primary/target.ts, the part kuru code reads.
export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "::1" || normalized.startsWith("127.") || normalized.endsWith(".localhost");
}
