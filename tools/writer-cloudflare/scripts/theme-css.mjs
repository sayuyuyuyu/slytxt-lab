/**
 * writer 用 theme.css の抽出。
 *
 * サイト本体の global.css から、トップレベルの `:root` と `:root.light`
 * の変数ブロックだけを取り出す。`@media` 内のブロック（印刷用パレット等）は
 * テーマではないため、抽出前に丸ごと取り除く。
 */
function stripMediaBlocks(css) {
  let result = "";
  let index = 0;
  while (index < css.length) {
    const mediaAt = css.indexOf("@media", index);
    if (mediaAt === -1) {
      result += css.slice(index);
      break;
    }
    result += css.slice(index, mediaAt);
    const openAt = css.indexOf("{", mediaAt);
    if (openAt === -1) break;
    let depth = 0;
    let cursor = openAt;
    for (; cursor < css.length; cursor++) {
      if (css[cursor] === "{") depth++;
      else if (css[cursor] === "}") {
        depth--;
        if (depth === 0) {
          cursor++;
          break;
        }
      }
    }
    index = cursor;
  }
  return result;
}

export function extractThemeCss(globalCss) {
  const topLevel = stripMediaBlocks(globalCss);
  return [...topLevel.matchAll(/:root(?:\.light)?\s*\{[^}]*\}/g)]
    .map((match) => match[0])
    .join("\n");
}
