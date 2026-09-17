/**
 * YAML frontmatter の最小実装。
 * サイトの frontmatter と、執筆用ドラフトの両方を扱えれば十分なので、
 * 対応するのは文字列・数値・真偽値・インライン配列・ブロック配列だけ。
 */

const RESERVED = /^(true|false|null|~|yes|no|on|off)$/i;
const NUMERIC = /^-?\d+(\.\d+)?$/;
const PLAIN = /^[^\s"'#,[\]{}&*!|>%@`:][^:[\]{}#,&*!|>%@`]*$/;

function splitInline(text) {
  const items = [];
  let current = "";
  let quote = "";
  for (const char of text) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ",") {
      items.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  items.push(current);
  return items.map((item) => item.trim()).filter((item) => item !== "");
}

export function parseScalar(raw) {
  const value = String(raw).trim();
  if (value === "") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (value.startsWith("[") && value.endsWith("]")) {
    return splitInline(value.slice(1, -1)).map((item) => parseScalar(item));
  }
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
    (value.startsWith("'") && value.endsWith("'") && value.length > 1)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function formatScalar(value) {
  const text = String(value);
  if (text === "") return '""';
  if (RESERVED.test(text) || NUMERIC.test(text)) return JSON.stringify(text);
  return PLAIN.test(text) ? text : JSON.stringify(text);
}

function formatValue(value) {
  if (Array.isArray(value)) return `[${value.map(formatScalar).join(", ")}]`;
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return formatScalar(value);
}

function parseBlock(lines) {
  const data = {};
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (!match) continue;
    const key = match[1];
    const rest = match[2].trim();

    if (rest === "") {
      const items = [];
      let cursor = index + 1;
      while (cursor < lines.length && /^\s*-\s+/.test(lines[cursor])) {
        items.push(parseScalar(lines[cursor].replace(/^\s*-\s+/, "")));
        cursor += 1;
      }
      if (items.length > 0) {
        data[key] = items;
        index = cursor - 1;
      } else {
        data[key] = null;
      }
      continue;
    }

    data[key] = parseScalar(rest);
  }
  return data;
}

export function parseFrontmatter(source) {
  const text = String(source ?? "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { data: {}, body: text, hasFrontmatter: false };
  }
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      end = index;
      break;
    }
  }
  if (end === -1) {
    return { data: {}, body: text, hasFrontmatter: false };
  }
  return {
    data: parseBlock(lines.slice(1, end)),
    body: lines.slice(end + 1).join("\n").replace(/^\n+/, ""),
    hasFrontmatter: true
  };
}

export function stringifyFrontmatter(data, body) {
  const lines = Object.entries(data)
    .filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (Array.isArray(value) && value.length === 0) return false;
      if (typeof value === "string" && value.trim() === "") return false;
      return true;
    })
    .map(([key, value]) => `${key}: ${formatValue(value)}`);
  const clean = String(body ?? "")
    .replace(/^\n+/, "")
    .replace(/\s+$/, "");
  return `---\n${lines.join("\n")}\n---\n\n${clean}\n`;
}
