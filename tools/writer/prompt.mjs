/**
 * 投稿前の誤字チェック用プロンプト。
 * 内容や文体は変えず、誤字だけを直す。本文の組み立ては publish.mjs が機械的に行う。
 */

export function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

export function fixPrompt(draft) {
  const plain = draft.category === "notes";
  return `${plain ? "平文のメモ" : "Markdown の文章"}を、誤字だけ直してそのまま公開できる形にする。

## 直す

- 誤字、脱字、変換ミス
- 同じ語の重複、助詞の抜け

## 変えない

- 内容、語順、文体、語彙。書かれていないことを足さない。
${plain ? "- 見出し、箇条書き、強調、リンクなどの Markdown にしない。改行と字だけをそのまま残す。" : "- 見出し、箇条書き、コードブロックなどの Markdown の構造。そのまま残す。"}
- 前置き、結び、総括を足さない。行を増やさない。

## 出力

本文だけを出力する。前置き、後始末、コードフェンスを書かない。

---

## 本文

\`\`\`
${draft.body.trim() || "(本文がありません)"}
\`\`\``;
}
