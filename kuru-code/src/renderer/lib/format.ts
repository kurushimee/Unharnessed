// How the window writes times, counts and money.

/** `now`, `5m`, `3h`, `2d`, `4w`, then the date. */
export function shortAge(ms: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A moment as the preference asks: an age, or a 24-hour or 12-hour clock (with the date when not today). */
export function stamp(ms: number, format: "relative" | "24h" | "12h", now = Date.now()): string {
  if (format === "relative") return shortAge(ms, now);
  const date = new Date(ms);
  const today = new Date(now).toDateString() === date.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: format === "12h" });
  return today ? time : `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export function longAgo(iso: string | number, now = Date.now()): string {
  const ms = typeof iso === "number" ? iso : Date.parse(iso);
  const age = shortAge(ms, now);
  return age === "now" ? "just now" : /\d$/.test(age) ? age : `${age} ago`;
}

/** 1.2k, 34k, 1.5M. */
export function compact(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n < 1_000_000_000) return `${Math.round(n / 1_000_000)}M`;
  return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
}

export function dollars(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** The last part of a path. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
