/** JST 固定の整形。Workers の Intl はロケールデータが限られるため自前で組む。 */

const JST_OFFSET_MINUTES = 9 * 60;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
] as const;

export type JstParts = {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
  weekday: number;
};

/** ISO 文字列を日本時間の要素に分解する。 */
export function toJstParts(iso: string): JstParts {
  const shifted = new Date(new Date(iso).getTime() + JST_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    seconds: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay()
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `2026-09-25 09:12` の形。 */
export function formatJst(iso: string): string {
  const at = toJstParts(iso);
  return `${at.year}-${pad(at.month)}-${pad(at.day)} ${pad(at.hours)}:${pad(at.minutes)}`;
}

/** RSS の pubDate に使う RFC 822 形式。 */
export function formatRfc822(iso: string): string {
  const at = toJstParts(iso);
  return `${WEEKDAYS[at.weekday]}, ${pad(at.day)} ${MONTHS[at.month - 1]} ${at.year} ${pad(at.hours)}:${pad(at.minutes)}:${pad(at.seconds)} +0900`;
}

/** その日（JST）の hour 時ちょうどを返す。過ぎていなければ前日に回す。 */
export function lastJstBoundary(now: Date, hour: number): Date {
  const shifted = now.getTime() + JST_OFFSET_MINUTES * 60_000;
  const jst = new Date(shifted);
  let boundary = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), hour, 0, 0, 0);
  if (boundary > shifted) boundary -= 24 * 60 * 60 * 1000;
  return new Date(boundary - JST_OFFSET_MINUTES * 60_000);
}
