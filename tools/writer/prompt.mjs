/**
 * エージェントへ渡すプロンプトの組み立て。
 * 文体の規範は ~/.agents/skills/slytxt-writing/SKILL.md をそのまま読み込む。
 * 差し替えたいときは SLYTXT_STYLE_FILE を指定する。
 */
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseFrontmatter } from "./frontmatter.mjs";
import { CATEGORY_LABELS } from "./drafts.mjs";

const STYLE_FILE =
  process.env.SLYTXT_STYLE_FILE ??
  path.join(os.homedir(), ".agents", "skills", "slytxt-writing", "SKILL.md");

export async function loadStyle() {
  const source = await readFile(STYLE_FILE, "utf8").catch(() => "");
  if (!source) return "";
  const { body, hasFrontmatter } = parseFrontmatter(source);
  return (hasFrontmatter ? body : source).trim();
}

export function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

function categoryLine(category) {
  const label = CATEGORY_LABELS[category] ?? CATEGORY_LABELS.tech;
  const scope = {
    tech: "AI、MCP、クラウド、プログラミングを実際に触って試したこと",
    journal: "旅行、ゲーム、音楽、ガジェット、日々の出来事",
    notes: "短いメモ。あとで記事にする前の走り書き",
    projects: "つくったものの紹介"
  }[category];
  return `${category}（${label}）— ${scope}`;
}

function siteSpec(category) {
  return `## サイトの形式

frontmatter はこのキーだけを、この順で書く。キーを増やさない。

\`\`\`yaml
---
title: 記事のタイトル（日本語。長くしない）
published: ${today()}
tags: [タグ, タグ, タグ]
slug: english-hyphen-slug
---
\`\`\`

- カテゴリは ${categoryLine(category)}。slug はこのカテゴリのディレクトリ名にだけ使い、本文には残さない。
- \`description\` は書かない。一覧に出す説明は本文から自動で作る。
- \`slug\` は半角英小文字とハイフンだけ。タイトルの内容を英語にした2〜5語。例: \`mcp-server-first-try\`
- \`tags\` は2〜4個。日本語でも英語でもよい。記事の中で実際に扱っている対象だけを書く。
- \`published\` は ${today()} をそのまま使う。
- 見出しは \`##\` から始める。\`#\` は使わない（タイトルは frontmatter にある）。`;
}

export async function expandPrompt(draft) {
  const style = await loadStyle();
  return `雑に書いたメモを、あとで自分で読み返して手を入れられる下書きに整える。

## 守ること

- メモに書かれていない事実を足さない。数値、製品名、日付、固有名詞をでっち上げない。
- 書かれていない感情や評価を足さない。「感動した」「便利だ」のような、メモから読み取れない感想を書かない。
- メモの意見と温度感を残す。無難な一般論に丸めない。
- 情報が薄いところは薄いままにする。水増ししない。全体が10行で終わってよい。
- 見出しは必要なところだけに立てる。短い断片ごとに見出しを作らない。見出しは2〜4個まで。
- 見出しの直後に、見出しと同じ文を置かない。「## 朝5時に起きた / 朝5時に起きた。」の繰り返しを書かない。
- メモが1行の羅列なら、箇条書きのまま残すか、1段落にまとめる。1行ごとに見出しと段落を作らない。
- 結びの挨拶、まとめ、次回の予告を足さない。
- 本文の1行目にタイトルを繰り返さない。
- メモの語彙を残す。砕けた言い回しを標準語に直さない。

## 出力

本文の Markdown だけを出力する。frontmatter は書かない。前置き・後始末・コードフェンス・「以下が下書きです」の類は書かない。

${style ? `## 文体の規範\n\n${style}` : ""}

---

## メモ

タイトル: ${draft.title}
カテゴリ: ${categoryLine(draft.category)}
タグ: ${draft.tags.length ? draft.tags.join(", ") : "未設定"}

\`\`\`
${draft.body.trim() || "(本文がまだありません)"}
\`\`\``;
}

export async function polishPrompt(draft) {
  const style = await loadStyle();
  return `雑なメモと下書きを、そのままサイトに公開できる記事に整える。

${siteSpec(draft.category)}

## 守ること

- 書かれていない事実を足さない。数値、製品名、日付、固有名詞、エラーメッセージをでっち上げない。書けない箇所は書かない。
- 書かれていない感情や評価を足さない。「嬉しかった」「満足している」「〜がポイントだ」のような、メモから読み取れない感想と総括を書かない。
- メモが短ければ記事も短くてよい。行数を稼がない。見出しを増やして水増ししない。
- 結びの挨拶や総括を新しく足さない。メモに余韻があるときだけ、短く終える。
- 主張と温度感を残す。無難な一般論や当たり障りのないまとめに丸めない。
- 誤字、脱字、同じ語の重複、助詞の抜けを直す。
- 同じ内容の繰り返しを削る。冗長な前置きと総括を落とす。
- 見出しの階層を整える。\`##\` と \`###\` だけを使う。
- コード、コマンド、設定はそのまま残す。動かない形に書き換えない。
- 事実が足りず意味が通らない箇所は、勝手に補わず元の言葉のまま残す。

## 出力

Markdown ファイルの中身をそのまま出力する。frontmatter から始め、本文が続く。
前置き・後始末・コードフェンス・「以下が記事です」の類は一切書かない。1文字目は \`-\` で始まる。

${style ? `## 文体の規範\n\n${style}` : ""}

---

## 元のメモと下書き

タイトル（仮）: ${draft.title}
カテゴリ: ${categoryLine(draft.category)}
タグ（仮）: ${draft.tags.length ? draft.tags.join(", ") : "未設定"}

\`\`\`
${draft.body.trim() || "(本文がまだありません)"}
\`\`\``;
}

/** note 用。平文のまま、誤字だけを直す。 */
export async function notePrompt(draft) {
  return `平文のメモを、誤字だけ直してそのまま公開できる形にする。

## 直す

- 誤字、脱字、変換ミス
- 同じ語の重複、助詞の抜け

## 変えない

- 内容、語順、文体、語彙。書かれていないことを足さない。
- 見出し、箇条書き、強調、リンクなどの Markdown にしない。改行と字だけをそのまま残す。
- 前置き、結び、総括を足さない。行を増やさない。

## 出力

本文だけを出力する。前置き、後始末、コードフェンスを書かない。

---

## メモ

\`\`\`
${draft.body.trim() || "(本文がありません)"}
\`\`\``;
}
