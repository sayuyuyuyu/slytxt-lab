import type { CollectionEntry } from "astro:content";

export type TaggedEntry =
  | CollectionEntry<"tech">
  | CollectionEntry<"misc">
  | CollectionEntry<"comic">
  | CollectionEntry<"game">
  | CollectionEntry<"anime">
  | CollectionEntry<"projects">;

// Symbols that would otherwise be dropped are spelled out (common tech
// names) or escaped by code point, so distinct tags never share a slug:
// "C++" -> "cplusplus", "C#" -> "csharp", ".NET" -> "dotnet", "!!!" -> "~21~~21~~21~".
const symbolNames = new Map([
  ["+", "plus"],
  ["#", "sharp"],
]);

export function slugifyTag(tag: string): string {
  const normalized = tag
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "-");
  let slug = "";
  for (const char of normalized) {
    if (/[\p{Letter}\p{Number}_-]/u.test(char)) {
      slug += char;
    } else if (symbolNames.has(char)) {
      slug += symbolNames.get(char);
    } else if (char === ".") {
      // Only a leading dot carries meaning (".NET"); inner dots stay dropped ("Node.js" -> "nodejs").
      if (slug === "") slug += "dot";
    } else {
      slug += `~${char.codePointAt(0)?.toString(16)}~`;
    }
  }
  return slug;
}

/**
 * タグで絞り込んだ一覧の URL（#881）。タグ専用ページは廃止し、一覧の
 * `?tag=` に寄せる。
 */
export function tagFilterPath(basePath: string, tag: string): string {
  const base = basePath.endsWith("/") ? basePath : `${basePath}/`;
  return `${base}?tag=${encodeURIComponent(slugifyTag(tag))}`;
}

export function collectTags(entries: TaggedEntry[]): Map<string, string> {
  const tags = new Map<string, string>();

  for (const entry of entries) {
    for (const tag of entry.data.tags) {
      const slug = slugifyTag(tag);
      if (slug === "") continue;
      if (!tags.has(slug)) {
        tags.set(slug, tag);
      }
    }
  }

  return tags;
}

/** タグごとの件数（多い順、同数は名前順）。一覧の絞り込みに出す（#881）。 */
export function tagCounts(entries: TaggedEntry[]): { slug: string; label: string; count: number }[] {
  const counts = new Map<string, { slug: string; label: string; count: number }>();
  for (const entry of entries) {
    const seen = new Set<string>();
    for (const tag of entry.data.tags) {
      const slug = slugifyTag(tag);
      if (slug === "" || seen.has(slug)) continue;
      seen.add(slug);
      const current = counts.get(slug);
      if (current) current.count += 1;
      else counts.set(slug, { slug, label: tag, count: 1 });
    }
  }
  return Array.from(counts.values()).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, "ja"),
  );
}
