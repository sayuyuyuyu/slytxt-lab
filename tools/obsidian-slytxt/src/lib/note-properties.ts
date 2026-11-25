/**
 * 公開直前の入力パネルに出す初期値（#905）。
 *
 * 値の決め方は公開時（preparePublish）と同じ規則。frontmatter に値があれば
 * それを、無ければ本文から導いた値を使う。DOM にも Obsidian の API にも
 * 触らない純関数。
 */
import { deriveTitle } from "./frontmatter.ts";
import { deriveDescription } from "./publish-plan.ts";
import { isPublishCategory, type PublishCategory } from "./slug.ts";

/** 埋めるプロパティの値。キーは frontmatter のキーそのもの。 */
export type PropertyPatch = Record<string, string | string[]>;

export type NotePropertiesInput = {
  frontmatter: Record<string, unknown> | null | undefined;
  /** frontmatter を除いた本文。 */
  body: string;
  /** ノート本文中の #タグ（frontmatter に tags が無いときの候補）。 */
  inlineTags?: string[];
  defaultCategory: PublishCategory;
};

/** frontmatter の tags は配列でもカンマ区切りの文字列でもよい。 */
export function normalizeTags(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.map((item) => String(item))
    : typeof value === "string"
      ? value.split(/[,、]/)
      : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of raw) {
    const tag = item.trim().replace(/^#/, "");
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags.slice(0, 10);
}

/**
 * 足りないプロパティだけを返す。既にある値には触らない。
 *
 * - title: 本文の最初の見出し（misc はタイトルを持たない）。
 * - description: 見出しを除いた本文の書き出し。
 * - category: 設定の既定値。
 * - tags: 本文の #タグ（無ければ何もしない。プロパティのリスト編集で足せる）。
 * - cover: 本文の最初の画像が URL のときだけ（Vault の画像はアップロードが要る）。
 *
 * 本文が空のノートには何もしない（走り書きのメモに「無題」を書き込まない）。
 */
export function missingProperties({
  frontmatter,
  body,
  inlineTags = [],
  defaultCategory
}: NotePropertiesInput): PropertyPatch {
  const front = frontmatter ?? {};
  const text = String(body ?? "").trim();
  const hasPublishValue = ["title", "category", "description", "cover", "tags"].some(
    (key) => front[key] !== undefined && front[key] !== null && String(front[key]).trim() !== ""
  );
  if (!text && !hasPublishValue) return {};

  const patch: PropertyPatch = {};
  const rawCategory = String(front.category ?? "").trim();
  const category = isPublishCategory(rawCategory) ? rawCategory : defaultCategory;
  if (!isPublishCategory(rawCategory)) patch.category = defaultCategory;

  // タイトルは本文の最初の見出し（あれば H1〜H6 の文字）から。公開時と同じく、
  // 見出しが無ければ最初の行をタイトルにする（misc はタイトルを持たない）。
  const lines = text.split("\n");
  const firstIndex = lines.findIndex((line) => line.trim() !== "");
  const firstLine = lines[firstIndex] ?? "";
  const headingText = firstLine.match(/^#{1,6}\s+(.+?)\s*$/)?.[1]?.trim() ?? "";
  const title = String(front.title ?? "").trim();
  const titleFromBody =
    category === "misc" ? "" : headingText || deriveTitle(category, "", text);
  const usesFirstLine = !title && titleFromBody !== "";
  if (usesFirstLine) patch.title = titleFromBody;

  if (!String(front.description ?? "").trim()) {
    // タイトルに使った行と、タグだけの行は説明文から除く
    // （「見出し＋本文」「本文＋タグ」にしない）。
    const rest = lines.filter((line, index) => {
      if (usesFirstLine && index === firstIndex) return false;
      return !/^\s*(#[^\s#]+\s*)+$/.test(line);
    });
    patch.description = deriveDescription(rest.join("\n"));
  }

  const tags = normalizeTags(front.tags);
  if (tags.length === 0) {
    const derived = normalizeTags(inlineTags);
    if (derived.length > 0) patch.tags = derived;
  }

  if (!String(front.cover ?? "").trim()) {
    const image = text.match(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/)?.[1] ?? "";
    if (/^https?:\/\//.test(image)) patch.cover = image;
  }

  return patch;
}

/** 公開パネルに最初から入れておく値。 */
export type PanelValues = {
  title: string;
  description: string;
  category: PublishCategory;
  tags: string[];
  cover: string;
};

/**
 * frontmatter と本文から、パネルの初期値を決める。
 * 空欄を並べないよう、本文から決まる値はここで入れておく（#905）。
 */
export function panelValues(input: NotePropertiesInput): PanelValues {
  const front = input.frontmatter ?? {};
  const missing = missingProperties(input);
  const text = (value: unknown, fallback: string | undefined) => {
    const given = String(value ?? "").trim();
    return given || (fallback ?? "");
  };
  return {
    title: text(front.title, missing.title as string | undefined),
    description: text(front.description, missing.description as string | undefined),
    category: isPublishCategory(String(front.category ?? ""))
      ? (front.category as PublishCategory)
      : ((missing.category as PublishCategory | undefined) ?? input.defaultCategory),
    tags: normalizeTags(front.tags).length > 0 ? normalizeTags(front.tags) : normalizeTags(missing.tags),
    cover: text(front.cover, missing.cover as string | undefined)
  };
}
