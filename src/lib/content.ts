import { getCollection, type CollectionEntry } from "astro:content";
import { slugifyTag } from "./tags";

export type ArticleCollection = "tech" | "life";
export type ArticleEntry = CollectionEntry<"tech"> | CollectionEntry<"life">;
export type ProjectEntry = CollectionEntry<"projects">;
export type SiteEntry = ArticleEntry | ProjectEntry;

export type PageData<T> = {
  entries: T[];
  currentPage: number;
  totalPages: number;
  prevUrl?: string;
  nextUrl?: string;
};

const PAGE_SIZE = 10;

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

export async function getArticles(collection: ArticleCollection): Promise<ArticleEntry[]> {
  const entries = await getCollection(collection, isPublished);
  return sortArticles(entries as ArticleEntry[]);
}

export async function getAllArticles(): Promise<ArticleEntry[]> {
  const [tech, life] = await Promise.all([getArticles("tech"), getArticles("life")]);
  return sortArticles([...tech, ...life]);
}

export async function getProjects(): Promise<ProjectEntry[]> {
  const entries = await getCollection("projects", isPublished);
  return sortProjects(entries);
}

export async function getAllEntries(): Promise<SiteEntry[]> {
  const [articles, projects] = await Promise.all([getAllArticles(), getProjects()]);
  return [...articles, ...projects];
}

export function getEntryDate(entry: SiteEntry): Date {
  return entry.collection === "projects" ? projectDate(entry) : articleDate(entry);
}

export function getEntrySlug(entry: SiteEntry): string {
  return entry.id.replace(/(\.sample)?\.(md|mdx)$/, "");
}

export function getEntryPath(entry: SiteEntry): string {
  return `/${entry.collection}/${getEntrySlug(entry)}/`;
}

export function getEntryKind(entry: SiteEntry): string {
  return entry.collection === "projects" ? "project" : "article";
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

export function paginateEntries<T>(
  entries: T[],
  basePath: string,
  page = 1,
  pageSize = PAGE_SIZE
): PageData<T> {
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * pageSize;

  return {
    entries: entries.slice(start, start + pageSize),
    currentPage,
    totalPages,
    prevUrl:
      currentPage > 1
        ? currentPage === 2
          ? `${basePath}/`
          : `${basePath}/page/${currentPage - 1}/`
        : undefined,
    nextUrl:
      currentPage < totalPages ? `${basePath}/page/${currentPage + 1}/` : undefined
  };
}

export function getPageNumbers(totalPages: number): number[] {
  return Array.from({ length: totalPages }, (_, index) => index + 1);
}
