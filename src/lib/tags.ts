import type { CollectionEntry } from "astro:content";

export type TaggedEntry =
  | CollectionEntry<"tech">
  | CollectionEntry<"life">
  | CollectionEntry<"projects">;

export function slugifyTag(tag: string): string {
  return tag
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{Letter}\p{Number}_-]/gu, "");
}

export function tagPath(tag: string): string {
  return `/tags/${slugifyTag(tag)}/`;
}

export function collectTags(entries: TaggedEntry[]): Map<string, string> {
  const tags = new Map<string, string>();

  for (const entry of entries) {
    for (const tag of entry.data.tags) {
      const slug = slugifyTag(tag);
      if (!tags.has(slug)) {
        tags.set(slug, tag);
      }
    }
  }

  return tags;
}
