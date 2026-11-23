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

export function preparePublish(meta: NoteMeta, today: string): PublishPayload {
  const title = deriveTitle(meta.category, meta.title, meta.body);
  const slug = normalizeSlug(meta.name, today);
  const description = (meta.description ?? "").trim() || deriveDescription(meta.body);
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
    content: documentBody(frontmatter, meta.body),
    path: contentPath(meta.category, slug),
    branch: branchName(meta.category, slug),
    url: publicUrl(meta.category, slug)
  };
}
