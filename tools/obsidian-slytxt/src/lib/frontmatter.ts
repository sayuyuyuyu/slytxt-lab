/**
 * 公開ファイルの frontmatter を組み立てる。サイト側のスキーマ
 * （src/content.config.ts）に合わせ、キーの順序を固定する。
 *
 * YAML の型に依存しないよう、値は必要最小限の引用だけを行う。
 */
export type FrontmatterInput = {
  title: string;
  description: string;
  published: string;
  updated?: string;
  tags: string[];
  cover?: string;
};

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
  lines.push("---");
  return lines.join("\n");
}

/** frontmatter + 本文。末尾の改行を1つに揃える。 */
export function documentBody(frontmatter: FrontmatterInput, body: string): string {
  return `${serializeFrontmatter(frontmatter)}\n\n${body.trim()}\n`;
}

/**
 * 記事のタイトル。無ければ本文の書き出しで補う。
 * notes はタイトルを持たないので空のままにする（writer と同じ）。
 */
export function deriveTitle(
  category: "tech" | "journal" | "notes",
  title: string | undefined,
  body: string
): string {
  const given = (title ?? "").trim();
  if (given && given !== "無題") return given;
  if (category === "notes") return "";
  const firstLine = body.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  const text = firstLine
    .replace(/[#>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...(text || "無題")];
  return chars.length > 40 ? `${chars.slice(0, 39).join("")}…` : chars.join("");
}
