import { getCollection } from "astro:content";
import { sortArticles, sortEntries, sortProjects } from "./entries";
import type { ArticleCollection, ArticleEntry, ProjectEntry, SiteEntry } from "./entries";

export type { ArticleCollection, ArticleEntry, ProjectEntry, SiteEntry } from "./entries";
export {
  getAdjacentArticles,
  getEntryDate,
  getEntryDateLabel,
  getEntryDescription,
  getEntryDisplayTitle,
  getEntryPath,
  getEntryPreview,
  getEntrySlug,
  hasXEmbed,
  sortArticles,
  sortEntries,
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

/** 記事と Projects をまとめ、日付の新しい順に返す（タグ一覧などの混在一覧用）。 */
export async function getAllEntries(): Promise<SiteEntry[]> {
  const [articles, projects] = await Promise.all([getAllArticles(), getProjects()]);
  return sortEntries([...articles, ...projects]);
}
