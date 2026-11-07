import { getCollection } from "astro:content";
import { sortArticles, sortProjects } from "./entries";
import type { ArticleEntry, ProjectEntry, SiteEntry, TechJournalEntry } from "./entries";

export type {
  ArticleCollection,
  ArticleEntry,
  ProjectEntry,
  SiteEntry,
  TechJournalEntry
} from "./entries";
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

export async function getArticles(
  collection: "tech" | "journal"
): Promise<TechJournalEntry[]> {
  const entries = await getCollection(collection, isPublished);
  return sortArticles(entries as TechJournalEntry[]);
}

/** Tech and Journal together. Notes are deliberately left out. */
export async function getAllArticles(): Promise<TechJournalEntry[]> {
  const [tech, journal] = await Promise.all([
    getArticles("tech"),
    getArticles("journal")
  ]);
  return sortArticles([...tech, ...journal]);
}

export async function getNotes(): Promise<ArticleEntry[]> {
  const entries = await getCollection("notes", isPublished);
  return sortArticles(entries as ArticleEntry[]);
}

/** Everything written: articles and notes. */
export async function getAllWriting(): Promise<ArticleEntry[]> {
  const [articles, notes] = await Promise.all([getAllArticles(), getNotes()]);
  return sortArticles([...articles, ...notes]);
}

export async function getProjects(): Promise<ProjectEntry[]> {
  const entries = await getCollection("projects", isPublished);
  return sortProjects(entries);
}

export async function getAllEntries(): Promise<SiteEntry[]> {
  const [articles, notes, projects] = await Promise.all([
    getAllArticles(),
    getNotes(),
    getProjects()
  ]);
  return [...articles, ...notes, ...projects];
}
