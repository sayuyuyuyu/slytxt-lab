import { getCollection } from "astro:content";
import { sortArticles, sortProjects } from "./entries";
import type { ArticleCollection, ArticleEntry, ProjectEntry, SiteEntry } from "./entries";

export type { ArticleCollection, ArticleEntry, ProjectEntry, SiteEntry } from "./entries";
export {
  getAdjacentArticles,
  getEntriesByTag,
  getEntryDate,
  getEntryDateLabel,
  getEntryDescription,
  getEntryDisplayTitle,
  getEntryPath,
  getEntryPreview,
  getEntrySlug,
  hasXEmbed,
  sortArticles,
  sortProjects,
  toPlainText
} from "./entries";

function isPublished<T extends SiteEntry>(entry: T): boolean {
  return !entry.data.draft;
}

export const ARTICLE_COLLECTIONS: ArticleCollection[] = [
  "tech",
  "misc",
  "comic",
  "game",
  "anime"
];

export async function getArticles(
  collection: ArticleCollection
): Promise<ArticleEntry[]> {
  const entries = await getCollection(collection, isPublished);
  return sortArticles(entries as ArticleEntry[]);
}

/** All article categories together. */
export async function getAllArticles(): Promise<ArticleEntry[]> {
  const perCategory = await Promise.all(
    ARTICLE_COLLECTIONS.map((collection) => getArticles(collection))
  );
  return sortArticles(perCategory.flat());
}

export async function getProjects(): Promise<ProjectEntry[]> {
  const entries = await getCollection("projects", isPublished);
  return sortProjects(entries);
}

export async function getAllEntries(): Promise<SiteEntry[]> {
  const [articles, projects] = await Promise.all([getAllArticles(), getProjects()]);
  return [...articles, ...projects];
}
