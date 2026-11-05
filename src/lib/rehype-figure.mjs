/**
 * 画像のキャプションを figure / figcaption で出す Sätteri hast プラグイン。
 *
 * 保存形式は ![alt](url "caption")。alt は代替テキスト、title が
 * キャプション（読者向けの説明文）という役割分担で、単独段落の画像に
 * title がある場合だけ、段落を figure に変えてキャプションを画像下に
 * 表示する。title は属性としても残すと二重になるので落とす。
 * 文中の画像や、title の無い画像は触らない。
 */

/** hast の段落ノードを受け取り、変換できれば figure ノード、無理なら null を返す。 */
export function figureFromParagraph(node) {
  if (node?.type !== "element" || node.tagName !== "p") return null;
  const children = (node.children ?? []).filter(
    (child) => !(child.type === "text" && String(child.value ?? "").trim() === "")
  );
  if (children.length !== 1) return null;
  const img = children[0];
  if (img?.type !== "element" || img.tagName !== "img") return null;
  const title = img.properties?.title;
  if (typeof title !== "string" || title.trim() === "") return null;
  const properties = { ...img.properties };
  delete properties.title;
  return {
    type: "element",
    tagName: "figure",
    properties: {},
    children: [
      { ...img, properties },
      {
        type: "element",
        tagName: "figcaption",
        properties: {},
        children: [{ type: "text", value: title }]
      }
    ]
  };
}

/** Sätteri の hast プラグイン（astro.config.mjs の hastPlugins に渡す）。 */
export const figureHastPlugin = {
  name: "slytxt-figure",
  element: {
    filter: ["p"],
    visit(node) {
      return figureFromParagraph(node) ?? undefined;
    }
  }
};

/**
 * 本文画像に loading="lazy" / decoding="async" を付ける。
 * 詳細ページの見出し画像（cover）は Markdown を通らないので対象外で、
 * 従来どおり遅延させない。本文画像はタイトルや cover より下に来るため、
 * 一覧カードやリンクカードと同じく遅延読み込みでよい。
 * 著者が属性を明示している場合はそちらを優先する。
 */
export function lazyImageNode(node) {
  if (node?.type !== "element" || node.tagName !== "img") return null;
  return {
    ...node,
    properties: { loading: "lazy", decoding: "async", ...node.properties }
  };
}

/** Sätteri の hast プラグイン（astro.config.mjs の hastPlugins に渡す）。 */
export const lazyImageHastPlugin = {
  name: "slytxt-lazy-image",
  element: {
    filter: ["img"],
    visit(node) {
      return lazyImageNode(node) ?? undefined;
    }
  }
};
