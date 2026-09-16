import { Resvg } from "@resvg/resvg-js";
import { formatDate } from "./format";
import { categoryLabels, site } from "./site";
import type { SiteEntry } from "./content";

const WIDTH = 1200;
const HEIGHT = 630;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapText(value: string, maxLength = 17): string[] {
  const characters = Array.from(value);
  const lines: string[] = [];

  for (let index = 0; index < characters.length; index += maxLength) {
    lines.push(characters.slice(index, index + maxLength).join(""));
  }

  if (lines.length > 3) lines[2] = Array.from(lines[2]).slice(0, maxLength - 1).join("") + "…";
  return lines.slice(0, 3);
}

export function getOgDate(entry: SiteEntry): Date {
  return entry.collection === "projects"
    ? entry.data.updated ?? entry.data.started
    : entry.data.updated ?? entry.data.published;
}

export function renderOgPng(options: {
  title: string;
  date?: Date;
  category?: keyof typeof categoryLabels;
}): Uint8Array {
  const titleLines = wrapText(options.title);
  const category = options.category ? categoryLabels[options.category] : site.name;
  const titleSpans = titleLines
    .map(
      (line, index) =>
        `<tspan x="90" dy="${index === 0 ? 0 : 76}">${escapeXml(line)}</tspan>`
    )
    .join("");

  const footer = options.date ? `${formatDate(options.date)} / ${site.name}` : site.description;
  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#fdfcf8"/>
  <path d="M90 72h1020M90 540h1020" stroke="#d9d3c7" stroke-width="2"/>
  <path d="M90 72h88" stroke="#a43d29" stroke-width="5"/>
  <text x="90" y="139" fill="#a43d29" font-size="28" font-family="Hiragino Sans, Noto Sans JP, sans-serif">${escapeXml(category)}</text>
  <text x="90" y="265" fill="#292721" font-size="56" font-weight="500" font-family="Hiragino Mincho ProN, Yu Mincho, Noto Serif CJK JP, serif">${titleSpans}</text>
  <text x="90" y="510" fill="#706a60" font-size="24" font-family="Hiragino Sans, Noto Sans JP, sans-serif">${escapeXml(footer)}</text>
</svg>`;

  return new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: WIDTH
    }
  })
    .render()
    .asPng();
}
