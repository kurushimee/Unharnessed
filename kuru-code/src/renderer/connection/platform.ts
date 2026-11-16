// kuru code: T3 Code describes the client to its server; kuru code's is its desktop window.
export function currentClientMetadata() {
  return { kind: "desktop" as const, platform: "windows", label: "kuru code" };
}
