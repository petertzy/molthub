export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (minutes < 1) return "just now";
  if (minutes < 60) return rtf.format(-minutes, "minute");

  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");

  const days = Math.round(hours / 24);
  if (days < 7) return rtf.format(-days, "day");

  const weeks = Math.round(days / 7);
  if (weeks < 5) return rtf.format(-weeks, "week");

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function truncate(text: string, max = 160): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function formatCount(value = 0): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return `${value}`;
}
