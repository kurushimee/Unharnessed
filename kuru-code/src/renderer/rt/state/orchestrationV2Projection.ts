// From T3 Code's client-runtime state/orchestrationV2Projection.ts, the part
// kuru code uses. T3 Code folds its server's domain events into a projection;
// kuru code builds the projection from Unharnessed's conversation instead
// (../../kuru/projection.ts), which records the one item a change replaced.

const arrayReplacements = new WeakMap<ReadonlyArray<unknown>, WeakMap<ReadonlyArray<unknown>, number>>();

/** The index of the one item `next` replaced in `previous`, when that is all that changed. */
export function getProjectionArrayReplacementIndex(
  previous: ReadonlyArray<unknown>,
  next: ReadonlyArray<unknown>,
): number | undefined {
  return arrayReplacements.get(previous)?.get(next);
}

/** Records that `next` is `previous` with its item at `index` replaced. */
export function recordProjectionArrayReplacement(
  previous: ReadonlyArray<unknown>,
  next: ReadonlyArray<unknown>,
  index: number,
): void {
  let replacements = arrayReplacements.get(previous);
  if (replacements === undefined) {
    replacements = new WeakMap();
    arrayReplacements.set(previous, replacements);
  }
  replacements.set(next, index);
}
