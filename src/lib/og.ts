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
  <defs>
    <radialGradient id="glow" cx="14%" cy="-10%" r="90%">
      <stop offset="0" stop-color="#4cc9f0" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#4cc9f0" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="34" height="34" patternUnits="userSpaceOnUse">
      <path d="M34 0H0V34" fill="none" stroke="#16233a" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#05070f"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grid)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
  <rect x="60" y="56" width="1080" height="518" rx="10" fill="#0b1220" stroke="#1b2942"/>
  <circle cx="96" cy="90" r="7" fill="#ff6b81"/>
  <circle cx="120" cy="90" r="7" fill="#ffd166"/>
  <circle cx="144" cy="90" r="7" fill="#5cf2b4"/>
  <text x="100" y="152" fill="#5cf2b4" font-size="26" font-family="Menlo, Consolas, monospace">$ ~/${escapeXml(category)}</text>
  <text x="100" y="280" fill="#d9e6f7" font-size="56" font-weight="600" font-family="Hiragino Sans, Noto Sans JP, sans-serif">${titleSpans}</text>
  <text x="100" y="520" fill="#7d8bab" font-size="24" font-family="Menlo, Consolas, monospace">${escapeXml(footer)}</text>
  <text x="1048" y="520" fill="#4cc9f0" font-size="24" font-family="Menlo, Consolas, monospace">█</text>
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
