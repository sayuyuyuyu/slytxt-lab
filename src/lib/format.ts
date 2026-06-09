export const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

export function getYear(date: Date): string {
  return String(date.getFullYear());
}

export function stripTrailingSlash(path: string): string {
  return path === "/" ? path : path.replace(/\/$/, "");
}
