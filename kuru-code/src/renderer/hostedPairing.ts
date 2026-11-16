// T3 Code's hostedPairing.ts, the part kuru code reads: its hosted web app's
// address, which its thread links point at. kuru code's threads are local:
// a link to one names it by its session id (kuru code://thread/<id>).
export const KURU_THREAD_LINK_ORIGIN = "kuru-code://thread";

export function configuredHostedAppUrl(): string {
  return KURU_THREAD_LINK_ORIGIN;
}
