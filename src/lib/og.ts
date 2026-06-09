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

function wrapText(value: string, maxLength = 21): string[] {
  const characters = Array.from(value);
  const lines: string[] = [];

  for (let index = 0; index < characters.length; index += maxLength) {
    lines.push(characters.slice(index, index + maxLength).join(""));
  }

  return lines.slice(0, 3);
}

export function getOgDate(entry: SiteEntry): Date {
  return entry.collection === "projects"
    ? entry.data.updated ?? entry.data.started
    : entry.data.updated ?? entry.data.published;
}

export function renderOgPng(options: {
  title: string;
  date: Date;
  category?: keyof typeof categoryLabels;
}): Uint8Array {
  const titleLines = wrapText(options.title);
  const category = options.category ? categoryLabels[options.category] : "しらゆの個人研究所";
  const titleSpans = titleLines
    .map(
      (line, index) =>
        `<tspan x="90" dy="${index === 0 ? 0 : 78}">${escapeXml(line)}</tspan>`
    )
    .join("");

  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#102423"/>
      <stop offset="0.52" stop-color="#18201f"/>
      <stop offset="1" stop-color="#3b2319"/>
    </linearGradient>
    <pattern id="grid" width="56" height="56" patternUnits="userSpaceOnUse">
      <path d="M 56 0 L 0 0 0 56" fill="none" stroke="#ffffff" stroke-opacity="0.055" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grid)"/>
  <rect x="64" y="64" width="1072" height="502" rx="28" fill="#0c1110" fill-opacity="0.42" stroke="#ffffff" stroke-opacity="0.14"/>
  <circle cx="1025" cy="142" r="72" fill="#14b8a6" fill-opacity="0.24"/>
  <circle cx="1072" cy="488" r="110" fill="#f59e0b" fill-opacity="0.16"/>
  <path d="M90 160h112" stroke="#5eead4" stroke-width="8" stroke-linecap="round"/>
  <text x="90" y="128" fill="#fbbf24" font-size="30" font-weight="700" font-family="Inter, Noto Sans JP, sans-serif">${escapeXml(category)}</text>
  <text x="90" y="278" fill="#ffffff" font-size="64" font-weight="800" font-family="Inter, Noto Sans JP, sans-serif">${titleSpans}</text>
  <text x="90" y="512" fill="#d8e0dc" font-size="30" font-weight="600" font-family="Inter, Noto Sans JP, sans-serif">${escapeXml(formatDate(options.date))} / ${escapeXml(site.name)}</text>
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
