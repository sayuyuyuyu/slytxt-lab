export const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Tokyo"
});

export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

const yearFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  timeZone: "Asia/Tokyo"
});

export function getYear(date: Date): string {
  const year = yearFormatter.formatToParts(date).find((part) => part.type === "year");
  return year ? year.value : String(date.getUTCFullYear());
}
