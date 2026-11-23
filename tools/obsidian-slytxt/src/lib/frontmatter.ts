/**
 * 公開ファイルの frontmatter を組み立てる。サイト側のスキーマ
 * （src/content.config.ts）に合わせ、キーの順序を固定する。
 *
 * YAML の型に依存しないよう、値は必要最小限の引用だけを行う。
 */
import type { PublishCategory } from "./slug";
export type FrontmatterInput = {
  title: string;
  description: string;
  published: string;
  updated?: string;
  tags: string[];
  cover?: string;
  /** プラグインが管理しない frontmatter の行。原文のまま後ろに置く。 */
  extras?: string[];
};

/** プラグインが組み立て直すキー。extras からは外す。 */
const MANAGED_KEYS = new Set([
  "title",
  "description",
  "published",
  "updated",
  "tags",
  "cover",
  "category"
]);

/**
 * ノートの frontmatter（--- の内側）から、管理外のキーの行を取り出す。
 * adult や未知のキーを公開ファイルでもそのまま残すため、値は解釈せず
 * 行のまま引き継ぐ（#773）。入れ子の行は直前のキーに付いていく。
 */
export function extractExtras(rawFrontmatter: string): string[] {
  const extras: string[] = [];
  let keeping = false;
  for (const line of String(rawFrontmatter ?? "").split("\n")) {
    if (line.trim() === "") continue;
    const key = line.match(/^([A-Za-z0-9_-]+)\s*:/);
    if (key) {
      keeping = !MANAGED_KEYS.has(key[1]);
      if (keeping) extras.push(line.replace(/\s+$/, ""));
      continue;
    }
    // 先頭が空白の行は直前のキーの続き。管理外のキーにだけ付ける。
    if (keeping && /^\s/.test(line)) extras.push(line.replace(/\s+$/, ""));
  }
  return extras;
}

/** YAML のプレーンテキストとして安全に書けない値を引用する。 */
function quote(value: string): string {
  if (value === "") return '""';
  const needsQuote =
    /^[\s]|[\s]$/.test(value) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) ||
    /: | #|[\n"\\]/.test(value) ||
    /^(true|false|yes|no|null|~|-?\d+(\.\d+)?)$/i.test(value);
  return needsQuote ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"` : value;
}

/** tags はインライン配列で書く（10件程度なので読みやすい）。 */
function tagList(tags: string[]): string {
  const unique = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 10);
  return `[${unique.map(quote).join(", ")}]`;
}

export function serializeFrontmatter(input: FrontmatterInput): string {
  const lines = ["---"];
  // タイトル無しのメモは title: "" を明示する（サイトのスキーマがキーを要求する）。
  lines.push(`title: ${quote(input.title)}`);
  lines.push(`description: ${quote(input.description)}`);
  lines.push(`published: ${input.published}`);
  if (input.updated) lines.push(`updated: ${input.updated}`);
  lines.push(`tags: ${tagList(input.tags)}`);
  if (input.cover) lines.push(`cover: ${quote(input.cover)}`);
  for (const line of input.extras ?? []) {
    if (line.trim()) lines.push(line);
  }
  lines.push("---");
  return lines.join("\n");
}

/** frontmatter + 本文。末尾の改行を1つに揃える。 */
export function documentBody(frontmatter: FrontmatterInput, body: string): string {
  return `${serializeFrontmatter(frontmatter)}\n\n${body.trim()}\n`;
}

/**
 * 単独で埋め込みになる行か。サイト側の isEmbedOnlyLine（src/lib/entries.ts）と
 * 同じ判定にし、画像だけの行も除く。本文の先頭が URL や画像でも、それを
 * タイトルにしないため（#774）。
 */
export function isEmbedOnlyLine(line: string): boolean {
  const text = line.trim();
  if (/^https?:\/\/\S+$/.test(text)) return true;
  if (/^<https?:\/\/\S+>$/.test(text)) return true;
  if (/^!\[[^\]]*\]\(\S*\)$/.test(text)) return true;
  const link = text.match(/^\[([^\]]+)\]\((\S+)\)$/);
  return link ? link[1] === link[2] : false;
}

/**
 * 記事のタイトル。無ければ本文の書き出しで補う。
 * misc（なんか）はタイトルを持たないので空のままにする（writer と同じ）。
 */
export function deriveTitle(
  category: PublishCategory,
  title: string | undefined,
  body: string
): string {
  const given = (title ?? "").trim();
  if (given && given !== "無題") return given;
  if (category === "misc") return "";
  const firstLine =
    body
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !isEmbedOnlyLine(line)) ?? "";
  const text = firstLine
    .replace(/[#>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...(text || "無題")];
  return chars.length > 40 ? `${chars.slice(0, 39).join("")}…` : chars.join("");
}
