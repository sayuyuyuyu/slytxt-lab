/**
 * 執筆中のプレビュー用に Markdown を HTML へ変換する。
 * 依存を増やさないため自前で持つ。対応するのは見出し、段落、強調、リンク、
 * 画像、箇条書き（入れ子とタスクリスト）、番号付きリスト、引用、コードブロック、
 * 表、水平線、脚注以外の GFM 相当。
 * Astro 側の出力と完全には一致しないので、最終確認はビルドしたページで行う。
 */

const FENCE = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9+#._-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*$/;
const HR = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const QUOTE = /^\s{0,3}>/;
const BR_LINE = /^\s*<br\s*\/?>\s*$/i;

const ATTR = { left: ' style="text-align:left"', center: ' style="text-align:center"', right: ' style="text-align:right"' };

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]
  );
}

// スキーム付きのURLは、https / mailto / tel だけ通す。
// javascript: や data: を本文から持ち込ませない。
const SAFE_URL = /^(?:https?:|mailto:|tel:)/i;

function safeUrl(raw) {
  const url = String(raw ?? "").trim();
  if (url === "") return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !SAFE_URL.test(url)) return null;
  return url;
}

function unquoteTitle(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/^&quot;|&quot;$/g, "")
    .replace(/^'|'$/g, "")
    .trim();
}

function inline(text) {
  const codes = [];
  const autolinks = [];
  let out = String(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });

  // エスケープ後に探すと < > が実体参照になっていて一致しない。先に退避する。
  out = out.replace(/<((?:https?|mailto):[^>\s]+)>/g, (_, href) => {
    autolinks.push(href);
    return `\u0001${autolinks.length - 1}\u0001`;
  });

  out = escapeHtml(out);
  // URL 内の括弧を1段だけ入れ子で許す。https://example.com/a_(b) を切らないため。
  out = out.replace(
    /!\[([^\]]*)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)(?:\s+([^)]*))?\)/g,
    (_, alt, src, title) => {
      const url = safeUrl(src);
      if (!url) return alt;
      const text = unquoteTitle(title);
      return `<img src="${url}" alt="${alt}"${text ? ` title="${text}"` : ""} />`;
    }
  );
  out = out.replace(
    /\[([^\]]+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)(?:\s+([^)]*))?\)/g,
    (_, label, href, title) => {
      const url = safeUrl(href);
      if (!url) return label;
      const text = unquoteTitle(title);
      return `<a href="${url}"${text ? ` title="${text}"` : ""}>${label}</a>`;
    }
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^\w_])_([^_\n]+)_/g, "$1<em>$2</em>");
  out = out.replace(/\u0001(\d+)\u0001/g, (_, index) => {
    const raw = autolinks[Number(index)];
    const label = escapeHtml(raw);
    const url = safeUrl(raw);
    return url ? `<a href="${url}">${label}</a>` : label;
  });
  out = out.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${escapeHtml(codes[Number(index)])}</code>`);

  return out;
}

function isBlockStart(line, next = "") {
  return (
    FENCE.test(line) ||
    HR.test(line) ||
    HEADING.test(line) ||
    QUOTE.test(line) ||
    LIST.test(line) ||
    BR_LINE.test(line) ||
    (line.includes("|") && TABLE_SEP.test(next))
  );
}

function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\" && trimmed[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function renderTable(lines, start) {
  const header = splitRow(lines[start]);
  const align = splitRow(lines[start + 1]).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "";
  });

  let index = start + 2;
  const rows = [];
  while (index < lines.length && lines[index].trim() !== "" && lines[index].includes("|")) {
    rows.push(splitRow(lines[index]));
    index += 1;
  }

  const head = header
    .map((cell, column) => `<th${ATTR[align[column]] ?? ""}>${inline(cell)}</th>`)
    .join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${header
          .map((_, column) => `<td${ATTR[align[column]] ?? ""}>${inline(row[column] ?? "")}</td>`)
          .join("")}</tr>`
    )
    .join("\n");

  return [
    `<table>\n<thead>\n<tr>${head}</tr>\n</thead>\n<tbody>\n${body}\n</tbody>\n</table>`,
    index
  ];
}

function renderList(lines, start) {
  const first = lines[start].match(LIST);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const startNumber = ordered ? Number(first[2].replace(/[.)]$/, "")) : 1;

  const items = [];
  let index = start;

  while (index < lines.length) {
    const match = lines[index].match(LIST);
    if (!match) break;

    if (match[1].length > baseIndent) {
      if (items.length === 0) break;
      const [nested, next] = renderList(lines, index);
      items[items.length - 1].children.push(nested);
      index = next;
      continue;
    }
    if (match[1].length < baseIndent) break;
    // 箇条書きと番号付きが切り替わったら、そこで1つのリストを閉じる。
    if (/\d/.test(match[2]) !== ordered) break;

    const text = [match[3]];
    index += 1;
    while (index < lines.length) {
      const line = lines[index];
      if (line.trim() === "") {
        const next = lines[index + 1] ?? "";
        const nextMatch = next.match(LIST);
        if ((nextMatch && nextMatch[1].length >= baseIndent) || /^\s{2,}\S/.test(next)) {
          text.push("");
          index += 1;
          continue;
        }
        break;
      }
      const nextMatch = line.match(LIST);
      if (nextMatch) break;
      text.push(line.replace(new RegExp(`^\\s{0,${baseIndent + 2}}`), ""));
      index += 1;
    }

    items.push({ text: text.join("\n"), children: [] });
  }

  const tag = ordered ? "ol" : "ul";
  const startAttr = ordered && startNumber !== 1 ? ` start="${startNumber}"` : "";
  const html = items
    .map((item) => {
      const parts = renderBlocks(item.text.split("\n"));
      let inner =
        parts.length === 1 && parts[0].startsWith("<p>") && parts[0].endsWith("</p>")
          ? parts[0].slice(3, -4)
          : parts.join("\n");
      const task = inner.match(/^\[([ xX])\]\s+([\s\S]*)$/);
      if (task) {
        const checked = task[1].toLowerCase() === "x" ? " checked" : "";
        inner = `<input type="checkbox" disabled${checked} /> ${task[2]}`;
      }
      return `<li>${inner}${item.children.length ? `\n${item.children.join("\n")}` : ""}</li>`;
    })
    .join("\n");

  return [`<${tag}${startAttr}>\n${html}\n</${tag}>`, index];
}

function renderBlocks(lines) {
  const out = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1][0];
      const closing = new RegExp(`^\\s*${marker}{3,}\\s*$`);
      const buffer = [];
      index += 1;
      while (index < lines.length && !closing.test(lines[index])) {
        buffer.push(lines[index]);
        index += 1;
      }
      index += 1;
      const language = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : "";
      out.push(`<pre><code${language}>${escapeHtml(buffer.join("\n"))}</code></pre>`);
      continue;
    }

    if (HR.test(line)) {
      out.push("<hr />");
      index += 1;
      continue;
    }

    // <br /> だけの行は、公開側（生 HTML を通す）と同じく改行として出す。
    // 本文中の生 HTML は inline 側でエスケープされるので、対象は単独行だけ。
    if (BR_LINE.test(line)) {
      out.push("<br />");
      index += 1;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const buffer = [];
      while (index < lines.length && lines[index].trim() !== "" && QUOTE.test(lines[index])) {
        buffer.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
        index += 1;
      }
      out.push(`<blockquote>\n${renderBlocks(buffer).join("\n")}\n</blockquote>`);
      continue;
    }

    if (line.includes("|") && TABLE_SEP.test(lines[index + 1] ?? "")) {
      const [html, next] = renderTable(lines, index);
      out.push(html);
      index = next;
      continue;
    }

    if (LIST.test(line)) {
      const [html, next] = renderList(lines, index);
      out.push(html);
      index = next;
      continue;
    }

    const buffer = [];
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !isBlockStart(lines[index], lines[index + 1] ?? "")
    ) {
      buffer.push(lines[index]);
      index += 1;
    }
    // 行末のバックスラッシュは公開側（CommonMark）と同じく強制改行にする。
    // エスケープされた \\ は対象外（末尾の \ が奇数個のときだけ1つ取り除く）。
    // inline の退避用コードポイント（\u0000 / \u0001）と衝突しない \u0002 を使う。
    const marked = buffer.map((raw) => {
      const trimmed = raw.replace(/[ \t]+$/, "");
      const trailing = trimmed.match(/\\+$/)?.[0].length ?? 0;
      return trailing % 2 === 1 ? `${trimmed.slice(0, -1)}\u0002` : raw;
    });
    out.push(`<p>${inline(marked.join("\n")).replaceAll("\u0002", "<br />")}</p>`);
  }

  return out;
}

export function renderMarkdown(source) {
  const text = String(source ?? "").replace(/\r\n?/g, "\n");
  return renderBlocks(text.split("\n")).join("\n");
}

/*
 * プレビュー用の埋め込み変換。
 *
 * 公開側（src/lib/remark-embed.mjs）と同じく、「URL だけの段落」を
 * 埋め込みに変え、キャプション付きの単独画像を figure にする。
 * 判定と出力するクラス名は公開側にそろえる。一般 URL の OGP は
 * ブラウザから取得できない（CORS）ため、プレビューではタイトルを
 * URL のままにしたカードに落とす（公開側はビルド時に OGP を付ける）。
 * X の公式ウィジェット（widgets.js）の読み込みは UI 側（app.js）が担う。
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{6,}$/;

function youtubeId(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^(www\.|m\.)/, "");
  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1).split("/")[0];
    return VIDEO_ID.test(id) ? id : null;
  }
  if (host !== "youtube.com") return null;
  if (parsed.pathname === "/watch") {
    const id = parsed.searchParams.get("v") ?? "";
    return VIDEO_ID.test(id) ? id : null;
  }
  const match = parsed.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,})/);
  return match ? match[1] : null;
}

function spotifyItem(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "open.spotify.com") return null;
  // パスの先頭にロケール（/intl-ja など）が付くことがある。
  const match = parsed.pathname.match(
    /^\/(?:intl-[A-Za-z]{2}(?:-[A-Za-z]{2})?\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{10,})/
  );
  return match ? { kind: match[1], id: match[2] } : null;
}

function xPost(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  if (host !== "x.com" && host !== "twitter.com") return null;
  const match = parsed.pathname.match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)/);
  return match ? { user: match[1], id: match[2] } : null;
}

/** URL を埋め込み種別に分ける。URL でなければ null。 */
export function classifyEmbedUrl(raw) {
  const url = String(raw ?? "").trim();
  if (!/^https?:\/\/\S+$/.test(url)) return null;
  const video = youtubeId(url);
  if (video) return { type: "youtube", id: video, url };
  const item = spotifyItem(url);
  if (item) return { type: "spotify", ...item, url };
  const post = xPost(url);
  if (post) return { type: "x", ...post, url };
  return { type: "link", url };
}

export function youtubeEmbedHtml(id) {
  return `<div class="embed embed--youtube"><iframe src="https://www.youtube-nocookie.com/embed/${escapeHtml(id)}" title="YouTube video player" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`;
}

export function spotifyEmbedHtml({ kind, id }) {
  // 高さは Spotify 公式埋め込みの標準（track / episode は 152、それ以外は 352）。
  const height = kind === "track" || kind === "episode" ? 152 : 352;
  return `<div class="embed embed--spotify"><iframe src="https://open.spotify.com/embed/${escapeHtml(kind)}/${escapeHtml(id)}" title="Spotify player" width="100%" height="${height}" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
}

export function xEmbedHtml({ url }) {
  const safe = escapeHtml(url);
  return `<div class="embed embed--x"><blockquote class="twitter-tweet" data-dnt="true"><a href="${safe}">${safe}</a></blockquote></div>`;
}

export function linkCardHtml({ url }) {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // URL として読めない場合はそのまま出す（到達しないはず）。
  }
  return `<a class="link-card" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><span class="link-card__body"><span class="link-card__title">${escapeHtml(url)}</span><span class="link-card__host">${escapeHtml(host)}</span></span></a>`;
}

/**
 * 本文から「単独段落の埋め込み対象 URL」を拾う。
 * 公開側の埋め込み判定（段落が URL 1つだけ）と同じ条件で、空行で区切った
 * 段落が URL 単独行（山括弧の autolink 形式を含む）のときだけ対象にする。
 * 一般 URL（type: "link"）は含めない。notes の注意表示に使う。
 */
export function loneEmbedUrls(source) {
  const found = [];
  for (const block of String(source ?? "").split(/\n[ \t]*\n/)) {
    const line = block.trim();
    if (line === "" || line.includes("\n")) continue;
    const autolink = line.match(/^<(https?:\/\/[^>\s]+)>$/);
    const classified = classifyEmbedUrl(autolink ? autolink[1] : line);
    if (classified && classified.type !== "link") found.push(classified);
  }
  return found;
}

/** URL から埋め込み HTML を作る。埋め込み対象でなければ null。 */
export function embedHtmlForUrl(url) {
  const classified = classifyEmbedUrl(url);
  if (!classified) return null;
  if (classified.type === "youtube") return youtubeEmbedHtml(classified.id);
  if (classified.type === "spotify") return spotifyEmbedHtml(classified);
  if (classified.type === "x") return xEmbedHtml(classified);
  return linkCardHtml(classified);
}

// renderMarkdown の出力に対する後処理で、公開側の変換を再現する。
// 属性値やテキスト中の URL は HTML エスケープ済み（& → &amp;）なので、
// 判定のときだけ &amp; を戻す。
function decodeAmp(text) {
  return String(text).replace(/&amp;/g, "&");
}

const LONE_IMAGE_PARAGRAPH = /<p><img src="([^"]+)" alt="([^"]*)"(?: title="([^"]*)")? \/><\/p>/g;
const LONE_URL_BLOCK =
  /<(p|li)>(?:<a href="([^"]+)"(?: title="[^"]*")?>([^<]+)<\/a>|([^<]+))<\/\1>/g;

/**
 * プレビュー用の変換。renderMarkdown の結果に、埋め込みと
 * キャプション付き画像の figure 化を重ねる。
 */
export function renderPreviewMarkdown(source) {
  let html = renderMarkdown(source);
  html = html.replace(LONE_IMAGE_PARAGRAPH, (match, src, alt, title) => {
    if (!title) return match;
    return `<figure><img src="${src}" alt="${alt}" /><figcaption>${title}</figcaption></figure>`;
  });
  html = html.replace(LONE_URL_BLOCK, (match, tag, href, label, plain) => {
    const url =
      plain !== undefined
        ? decodeAmp(plain)
        : decodeAmp(href) === decodeAmp(label)
          ? decodeAmp(href)
          : null;
    if (!url) return match;
    const embed = embedHtmlForUrl(url);
    if (!embed) return match;
    // リスト項目の中では <li> で包んだままにする（公開側も項目内に埋め込む）。
    return tag === "li" ? `<li>${embed}</li>` : embed;
  });
  return html;
}

/**
 * 文字数表示用の数え方。本文の見た目の文字数を数えるため、
 * plainText で markdown の記号・リンク URL・画像記法を落としてから、
 * 空白と改行を除いて数える（note の「改行を除いた文字数」に寄せた）。
 */
export function textLength(source) {
  const lines = String(source ?? "")
    .split("\n")
    .map((line) => {
      // 表はセル内のテキストだけを数える（パイプと区切り行は記号）。
      if (!/^\s*\|/.test(line)) return line;
      if (/^[\s:|-]+$/.test(line)) return "";
      return line.replace(/\|/g, " ");
    });
  const stripped = lines
    .join("\n")
    // 区切り線は丸ごと落とす（リスト記号より先に処理する）。
    .replace(/^\s*[-*_](?:\s*[-*_]){2,}\s*$/gm, "")
    // タスクリストのチェックボックスとリスト記号は数えない。
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+/gm, "");
  return [...plainText(stripped).replace(/\s/g, "")].length;
}

/** 一覧やプレビューの見出しに使う、本文から最初の段落を抜き出す処理。 */
/** 文字列をコードポイント単位で切り詰める。絵文字などのサロゲートペアを分断しない。 */
export function truncateText(text, limit) {
  const value = String(text ?? "");
  const chars = Array.from(value);
  return chars.length <= limit ? value : chars.slice(0, limit).join("");
}

export function plainText(source) {
  return String(source ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    // 生の HTML（<br /> など）は表示用の記号なので、文字列として残さない。
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?[A-Za-z][^>\n]*>/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
