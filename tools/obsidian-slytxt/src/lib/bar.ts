/**
 * ノート画面に埋め込む公開バー（設計案B）の状態と操作。
 *
 * DOM にも Obsidian の API にも触らない純関数だけを置き、バーのウィジェット
 * （src/bar-widget.ts）と main.ts から使う。frontmatter の値が正で、バーの
 * 表示はそれを読んだ結果にすぎない（#849）。
 */
import { deriveTitle } from "./frontmatter.ts";
import { deriveDescription, firstImageSource, splitHeadingTitle } from "./publish-plan.ts";
import { PUBLISH_CATEGORIES, isPublishCategory, type PublishCategory } from "./slug.ts";

/** バーに出す値。title はバーに出さないが、公開で使うので持っておく。 */
export type BarState = {
  category: PublishCategory;
  tags: string[];
  cover: string;
  title: string;
  description: string;
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
    const tag = item.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags.slice(0, 10);
}

/** 入力された文字列をタグにする。カンマ・読点・空白のどれでも区切れる。 */
export function parseTagInput(input: string): string[] {
  return normalizeTags(
    String(input ?? "")
      .split(/[,、\s]+/)
      .filter(Boolean)
      .join(",")
  );
}

/**
 * frontmatter と本文から、開いた時点のバーの値を決める。
 * 空欄を並べるのではなく、本文から決められる値は最初から入れておく。
 */
export function barStateFromNote(
  frontmatter: Record<string, unknown> | null | undefined,
  body: string,
  defaultCategory: PublishCategory
): BarState {
  const front = frontmatter ?? {};
  const rawCategory = String(front.category ?? "");
  const category = isPublishCategory(rawCategory) ? rawCategory : defaultCategory;
  const givenTitle = String(front.title ?? "").trim();
  const description = String(front.description ?? "").trim();
  const givenCover = String(front.cover ?? "").trim();
  const imageSource = firstImageSource(body);
  const cover = givenCover || (imageSource && /^https?:\/\//.test(imageSource) ? imageSource : "");

  // タイトルの決め方と、見出しを本文から外すかどうかは公開時（preparePublish）
  // と同じにする。説明文が「見出し＋本文」にならないようにするため。
  const heading = category === "misc" ? null : splitHeadingTitle(body);
  const usesHeading = Boolean(heading) && (!givenTitle || givenTitle === "無題" || givenTitle === heading?.heading);
  const title = givenTitle || (heading ? heading.heading : deriveTitle(category, "", body));
  const descriptionBody = usesHeading && heading ? heading.body : body;
  return {
    category,
    tags: normalizeTags(front.tags),
    cover,
    title,
    description: description || deriveDescription(descriptionBody)
  };
}

/** チップを押したときの次のカテゴリ。並びはサイトの区分と同じ。 */
export function nextCategory(
  category: PublishCategory,
  categories: PublishCategory[] = PUBLISH_CATEGORIES
): PublishCategory {
  const index = categories.indexOf(category);
  return categories[(index + 1) % categories.length] ?? categories[0] ?? "misc";
}

/** タグを足す。重複・空・上限（10件）は落とす。 */
export function addTags(tags: string[], input: string): string[] {
  return normalizeTags([...tags, ...parseTagInput(input)]);
}

/** タグを外す。 */
export function removeTag(tags: string[], tag: string): string[] {
  return tags.filter((item) => item !== tag);
}

/**
 * バーの操作を frontmatter に反映するときの差分。値の正は frontmatter のまま。
 * タイトルと説明は、空のときだけ本文から補った値を書き戻す。
 */
export function frontmatterPatchFor(state: BarState): Record<string, unknown> {
  return {
    category: state.category,
    tags: state.tags,
    cover: state.cover,
    title: state.title,
    description: state.description
  };
}
