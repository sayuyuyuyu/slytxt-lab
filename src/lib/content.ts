import { getCollection, type CollectionEntry } from "astro:content";
import { slugifyTag } from "./tags";

export type ArticleCollection = "tech" | "journal" | "notes";
export type ArticleEntry =
  | CollectionEntry<"tech">
  | CollectionEntry<"journal">
  | CollectionEntry<"notes">;
export type ProjectEntry = CollectionEntry<"projects">;
export type SiteEntry = ArticleEntry | ProjectEntry;

/** URL segment for each article collection. `notes` sits outside `articles`. */
const ARTICLE_BASE: Record<ArticleCollection, string> = {
  tech: "articles/tech",
  journal: "articles/journal",
  notes: "notes"
};

function isPublished<T extends SiteEntry>(entry: T): boolean {
  return !entry.data.draft;
}

function articleDate(entry: ArticleEntry): Date {
  return entry.data.updated ?? entry.data.published;
}

function projectDate(entry: ProjectEntry): Date {
  return entry.data.updated ?? entry.data.started;
}

export function sortArticles<T extends ArticleEntry>(entries: T[]): T[] {
  return [...entries].sort(
    (a, b) => articleDate(b).getTime() - articleDate(a).getTime()
  );
}

export function sortProjects<T extends ProjectEntry>(entries: T[]): T[] {
  return [...entries].sort(
    (a, b) => projectDate(b).getTime() - projectDate(a).getTime()
  );
}

export async function getArticles(
  collection: "tech" | "journal"
): Promise<ArticleEntry[]> {
  const entries = await getCollection(collection, isPublished);
  return sortArticles(entries as ArticleEntry[]);
}

/** Tech and Journal together. Notes are deliberately left out. */
export async function getAllArticles(): Promise<ArticleEntry[]> {
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

export function getEntryDate(entry: SiteEntry): Date {
  return entry.collection === "projects" ? projectDate(entry) : articleDate(entry);
}

export function getEntrySlug(entry: SiteEntry): string {
  return entry.id.replace(/(\.sample)?\.(md|mdx)$/, "");
}

export function getEntryPath(entry: SiteEntry): string {
  if (entry.collection === "projects") return `/projects/${getEntrySlug(entry)}/`;
  return `/${ARTICLE_BASE[entry.collection]}/${getEntrySlug(entry)}/`;
}

export function getEntryKind(entry: SiteEntry): string {
  if (entry.collection === "projects") return "project";
  return entry.collection === "notes" ? "note" : "article";
}

export function getEntriesByTag(entries: SiteEntry[], tagSlug: string): SiteEntry[] {
  return entries.filter((entry) =>
    entry.data.tags.some((tag) => slugifyTag(tag) === tagSlug)
  );
}

export function getAdjacentArticles(entries: ArticleEntry[], currentId: string) {
  const index = entries.findIndex((entry) => entry.id === currentId);

  return {
    previous: index > 0 ? entries[index - 1] : undefined,
    next: index >= 0 && index < entries.length - 1 ? entries[index + 1] : undefined
  };
}
