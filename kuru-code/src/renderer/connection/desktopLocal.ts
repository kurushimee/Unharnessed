// kuru code: kuru code's one environment is this machine, served by its own main process: every connection is the desktop's local one.
export function isDesktopLocalConnectionTarget(_target: unknown): boolean {
  return true;
}
