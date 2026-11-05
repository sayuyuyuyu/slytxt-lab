import { getCollection, type CollectionEntry } from "astro:content";
import { slugifyTag } from "./tags";

export type ArticleCollection = "tech" | "journal" | "notes";
export type ArticleEntry =
  | CollectionEntry<"tech">
  | CollectionEntry<"journal">
  | CollectionEntry<"notes">;
export type TechJournalEntry = CollectionEntry<"tech"> | CollectionEntry<"journal">;
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

export function getEntryDate(entry: SiteEntry): Date {
  return entry.collection === "projects" ? projectDate(entry) : articleDate(entry);
}

/** getEntryDate が返す日付の意味。更新日がある場合は Updated、無ければ記事・メモは Published、Projects は Started。 */
export function getEntryDateLabel(entry: SiteEntry): string {
  if (entry.data.updated) return "Updated";
  return entry.collection === "projects" ? "Started" : "Published";
}

/** 埋め込みになる単独 URL 行か（裸 URL / autolink / テキストが URL そのもののリンク）。公開側ではプレイヤーやカードに変換されるため、本文テキストとして数えない。 */
function isEmbedOnlyLine(line: string): boolean {
  const text = line.trim();
  if (/^https?:\/\/\S+$/.test(text)) return true;
  if (/^<https?:\/\/\S+>$/.test(text)) return true;
  const link = text.match(/^\[([^\]]+)\]\((\S+)\)$/);
  return link ? link[1] === link[2] : false;
}

/** 本文の書き出しから作るプレビュー。先頭3行（埋め込みになる単独 URL 行を除く）をプレーンテキストにし、maxLength 字（既定は90字）で切る。 */
export function getEntryPreview(entry: SiteEntry, maxLength = 90): string {
  const lines = (entry.body ?? "")
    .trim()
    .split("\n")
    .filter((line) => line.trim() && !isEmbedOnlyLine(line));
  const text = toPlainText(lines.slice(0, 3).join("\n"));
  const chars = Array.from(text);
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join("")}…` : text;
}

/** 表示名。タイトルが空のときはプレビュー（本文の書き出し）から作る。 */
export function getEntryDisplayTitle(entry: SiteEntry): string {
  const title = entry.data.title?.trim();
  if (title) return title;
  return getEntryPreview(entry) || "（無題）";
}

/** meta / RSS 用の説明文。明示 description が表示名と同一なら使わず、本文プレビュー（200字）も表示名と同一なら undefined を返し、呼び出し側の既定文に落とす。 */
export function getEntryDescription(entry: SiteEntry): string | undefined {
  const displayTitle = getEntryDisplayTitle(entry);
  const explicit = entry.data.description;
  if (explicit && explicit !== displayTitle) return explicit;
  const preview = getEntryPreview(entry, 200);
  return preview && preview !== displayTitle ? preview : undefined;
}

export function getEntrySlug(entry: SiteEntry): string {
  return entry.id.replace(/(\.sample)?\.md$/, "");
}

export function getEntryPath(entry: SiteEntry): string {
  if (entry.collection === "projects") return `/projects/${getEntrySlug(entry)}/`;
  return `/${ARTICLE_BASE[entry.collection]}/${getEntrySlug(entry)}/`;
}

export function getEntriesByTag(entries: SiteEntry[], tagSlug: string): SiteEntry[] {
  return entries.filter((entry) =>
    entry.data.tags.some((tag) => slugifyTag(tag) === tagSlug)
  );
}

export function getAdjacentArticles<T extends ArticleEntry>(entries: T[], currentId: string) {
  const index = entries.findIndex((entry) => entry.id === currentId);

  return {
    previous: index > 0 ? entries[index - 1] : undefined,
    next: index >= 0 && index < entries.length - 1 ? entries[index + 1] : undefined
  };
}

/** Markdown の記号を落としてプレーンテキストにする。writer 側の plainText と扱いをそろえる。 */
export function toPlainText(source: string): string {
  return String(source ?? "")
    .split("\n")
    .filter((line) => !isEmbedOnlyLine(line))
    .join("\n")
    .replace(/```[\s\S]*?```/g, " ")
    // 生の HTML（<br /> など）は表示用の記号なので、文字列として残さない。
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?[A-Za-z][^>\n]*>/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** X のポスト URL だけの段落（埋め込みになる形）が本文にあるか。widgets.js の読み込み判定に使う。 */
export function hasXEmbed(body: string | undefined): boolean {
  if (!body) return false;
  const post = /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/\d+/;
  return body.split("\n").some((line) => {
    const text = line.trim();
    const link = text.match(/^\[([^\]]+)\]\((\S+)\)$/);
    if (link) return link[1] === link[2] && post.test(link[2]);
    const autolink = text.match(/^<(\S+)>$/);
    if (autolink) return post.test(autolink[1]);
    return /^\S+$/.test(text) && post.test(text);
  });
}
