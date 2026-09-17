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

const ATTR = { left: ' style="text-align:left"', center: ' style="text-align:center"', right: ' style="text-align:right"' };

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]
  );
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
  let out = String(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });

  out = escapeHtml(out);
  out = out.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+([^)]*))?\)/g,
    (_, alt, src, title) => {
      const text = unquoteTitle(title);
      return `<img src="${src}" alt="${alt}"${text ? ` title="${text}"` : ""} />`;
    }
  );
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+([^)]*))?\)/g,
    (_, label, href, title) => {
      const text = unquoteTitle(title);
      return `<a href="${href}"${text ? ` title="${text}"` : ""}>${label}</a>`;
    }
  );
  out = out.replace(
    /<((?:https?|mailto):[^>\s]+)>/g,
    (_, href) => `<a href="${href}">${href}</a>`
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^\w_])_([^_\n]+)_/g, "$1<em>$2</em>");
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
    out.push(`<p>${inline(buffer.join("\n"))}</p>`);
  }

  return out;
}

export function renderMarkdown(source) {
  const text = String(source ?? "").replace(/\r\n?/g, "\n");
  return renderBlocks(text.split("\n")).join("\n");
}

/** 一覧やプレビューの見出しに使う、本文から最初の段落を抜き出す処理。 */
export function plainText(source) {
  return String(source ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
