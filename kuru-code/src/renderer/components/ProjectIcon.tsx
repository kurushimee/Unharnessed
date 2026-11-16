import { cn } from "~/lib/utils";

// T3 Code's project monogram: a tinted tile with the name's first letters,
// its colour picked from the name so a project keeps it.
const COLORS = [
  "text-red-600 dark:text-red-400",
  "text-orange-600 dark:text-orange-400",
  "text-amber-600 dark:text-amber-400",
  "text-lime-600 dark:text-lime-400",
  "text-emerald-600 dark:text-emerald-400",
  "text-teal-600 dark:text-teal-400",
  "text-cyan-600 dark:text-cyan-400",
  "text-sky-600 dark:text-sky-400",
  "text-blue-600 dark:text-blue-400",
  "text-indigo-600 dark:text-indigo-400",
  "text-violet-600 dark:text-violet-400",
  "text-fuchsia-600 dark:text-fuchsia-400",
  "text-pink-600 dark:text-pink-400",
  "text-rose-600 dark:text-rose-400",
];

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function monogram(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[1]].map((word) => Array.from(segmenter.segment(word))[0]?.segment ?? "") : Array.from(segmenter.segment(name)).slice(0, 2).map((part) => part.segment);
  const text = letters.join("");
  return words.length > 1 ? text.toUpperCase() : text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function colorOf(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export function ProjectIcon({ name, className }: { name: string; className?: string }) {
  const text = monogram(name) || "?";
  return (
    <span aria-hidden="true" className={cn("inline-flex size-4 shrink-0 items-center justify-center", className)}>
      <svg viewBox="0 0 16 16" className={cn("size-full overflow-hidden rounded-[25%] font-mono select-none", colorOf(name))} style={{ backgroundColor: "color-mix(in srgb, currentColor 14%, transparent)" }}>
        <text
          x="8"
          y="10.8"
          textAnchor="middle"
          fill="currentColor"
          fontSize="8.25"
          fontWeight="700"
          textLength={Array.from(segmenter.segment(text)).length === 1 ? 6 : 12}
          lengthAdjust="spacingAndGlyphs"
          textRendering="geometricPrecision"
        >
          {text}
        </text>
      </svg>
    </span>
  );
}
