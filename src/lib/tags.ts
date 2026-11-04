import type { CollectionEntry } from "astro:content";

export type TaggedEntry =
  | CollectionEntry<"tech">
  | CollectionEntry<"journal">
  | CollectionEntry<"notes">
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

export function tagPath(tag: string): string {
  return `/tags/${slugifyTag(tag)}/`;
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
