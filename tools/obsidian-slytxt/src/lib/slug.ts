/**
 * 公開先のパスとブランチ名。writer（tools/writer-cloudflare）と同じ規則に揃える。
 * - 記事は src/content/<category>/<slug>.md、ブランチは write/<slug>
 */
export type PublishCategory = "tech" | "misc" | "comic" | "game" | "anime";

export const PUBLISH_CATEGORIES: PublishCategory[] = ["tech", "misc", "comic", "game", "anime"];

export function isPublishCategory(value: string): value is PublishCategory {
  return (PUBLISH_CATEGORIES as string[]).includes(value);
}

/** 英数字とハイフンだけの slug。作れないときは日付に落とす（writer と同じ）。 */
export function normalizeSlug(raw: string, fallbackDate: string): string {
  const cleaned = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return cleaned || `post-${fallbackDate.replace(/-/g, "")}`;
}

export function contentPath(category: PublishCategory, slug: string): string {
  return `src/content/${category}/${slug}.md`;
}

export function branchName(_category: PublishCategory, slug: string): string {
  return `write/${slug}`;
}

export function publicUrl(category: PublishCategory, slug: string): string {
  return `https://slytxt.dev/articles/${category}/${slug}/`;
}

/** JST の今日（writer の today() と同じ扱い）。 */
export function todayInTokyo(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  return parts;
}
