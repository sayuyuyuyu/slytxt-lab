/**
 * ノート1件から公開に必要な一式（slug・frontmatter・ファイル内容・ブランチ・URL）
 * を組み立てる。通信は含まないので単体で検証できる。
 */
import { deriveTitle, documentBody, isEmbedOnlyLine, type FrontmatterInput } from "./frontmatter.ts";
import {
  branchName,
  contentPath,
  normalizeSlug,
  publicUrl,
  type PublishCategory
} from "./slug.ts";

export type NoteMeta = {
  /** ファイル名（拡張子なし）。slug の材料。 */
  name: string;
  category: PublishCategory;
  title?: string;
  description?: string;
  tags?: string[];
  cover?: string;
  /** 既存の公開日。再編集のときに入る。 */
  published?: string;
  /** ノートに書かれている更新日。再公開で引き継ぐ。 */
  updated?: string;
  /** 管理外の frontmatter 行（adult など）。原文のまま引き継ぐ。 */
  extras?: string[];
  body: string;
};

export type PublishPayload = {
  category: PublishCategory;
  title: string;
  slug: string;
  frontmatter: FrontmatterInput;
  content: string;
  path: string;
  branch: string;
  url: string;
};

/** 本文の書き出しから説明文を作る。文末で切れるならそこで終える。 */
export function deriveDescription(body: string, limit = 90): string {
  const text = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !isEmbedOnlyLine(line))
    .join(" ")
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[#>*_`~\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...text];
  if (chars.length <= limit) return text;
  const head = chars.slice(0, limit);
  const sentenceEnd = Math.max(
    head.lastIndexOf("。"),
    head.lastIndexOf("！"),
    head.lastIndexOf("？")
  );
  if (sentenceEnd >= limit * 0.4) return chars.slice(0, sentenceEnd + 1).join("");
  return `${chars.slice(0, limit - 1).join("").trimEnd()}…`;
}

/**
 * 更新日を決める（#772）。初回公開では付けず、公開済みのノートを別の日に
 * 再公開したらその日を入れる。ノート側に updated があれば落とさない。
 */
export function resolveUpdated(
  meta: NoteMeta,
  published: string,
  today: string
): string | undefined {
  const given = (meta.updated ?? "").trim();
  const republished = Boolean(meta.published) && today > published;
  const values = [given, republished ? today : ""].filter(Boolean).sort();
  return values.length ? values[values.length - 1] : undefined;
}

/**
 * 本文の最初の見出し（H1）をタイトルとして切り出す。
 * 先頭の見出しでタイトルを付けたつもりのノートを、そのまま公開できるように
 * するためのもの。見出しが無ければ null。
 */
export function splitHeadingTitle(body: string): { heading: string; body: string } | null {
  const lines = body.split("\n");
  const index = lines.findIndex((line) => line.trim() !== "");
  if (index === -1) return null;
  const first = lines[index];
  if (first === undefined) return null;
  const heading = first.match(/^#\s+(.+?)\s*$/)?.[1]?.trim();
  if (!heading) return null;
  const rest = lines
    .slice(index + 1)
    .join("\n")
    .replace(/^\n+/, "");
  return { heading, body: rest };
}

/**
 * 本文で最初に出てくる画像の参照を返す。Markdown 記法は URL かパス、
 * Obsidian の埋め込みは Vault 内のファイル名（パス）をそのまま返す。
 * 画像が無ければ null。
 */
export function firstImageSource(body: string): string | null {
  const md = body.match(/!\[[^\]]*\]\(\s*(\S+?)\s*\)/);
  const wiki = body.match(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
  const mdSrc = md?.[1];
  const wikiSrc = wiki?.[1]?.trim();
  if (mdSrc !== undefined && wikiSrc !== undefined) {
    return (md?.index ?? 0) <= (wiki?.index ?? 0) ? mdSrc : wikiSrc;
  }
  if (mdSrc !== undefined) return mdSrc;
  if (wikiSrc !== undefined) return wikiSrc;
  return null;
}

export function preparePublish(meta: NoteMeta, today: string): PublishPayload {
  let body = meta.body;
  let givenTitle = (meta.title ?? "").trim();
  // 最初の見出しがタイトル代わりなら、タイトルに使って本文からは除く。
  // タイトルが別に指定されていて見出しと一致する場合も、本文の二重表示を避けて除く。
  const heading = splitHeadingTitle(body);
  if (meta.category !== "misc" && heading) {
    if (!givenTitle || givenTitle === "無題") {
      givenTitle = heading.heading;
      body = heading.body;
    } else if (givenTitle === heading.heading) {
      body = heading.body;
    }
  }
  const title = deriveTitle(meta.category, givenTitle, body);
  const slug = normalizeSlug(meta.name, today);
  const description = (meta.description ?? "").trim() || deriveDescription(body);
  const published = meta.published ?? today;
  const updated = resolveUpdated(meta, published, today);
  const frontmatter: FrontmatterInput = {
    title,
    description,
    published,
    ...(updated ? { updated } : {}),
    tags: meta.tags ?? [],
    ...(meta.cover ? { cover: meta.cover } : {}),
    ...(meta.extras && meta.extras.length ? { extras: meta.extras } : {})
  };
  return {
    category: meta.category,
    title,
    slug,
    frontmatter,
    content: documentBody(frontmatter, body),
    path: contentPath(meta.category, slug),
    branch: branchName(meta.category, slug),
    url: publicUrl(meta.category, slug)
  };
}
