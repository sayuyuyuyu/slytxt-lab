import { Resvg } from "@resvg/resvg-js";
import { formatDate } from "./format";
import { escapeXml } from "./xml";
import { categoryLabels, site } from "./site";
import { wrapText } from "./og-wrap";

export { wrapText } from "./og-wrap";

const WIDTH = 1200;
const HEIGHT = 630;

/** OG 画像の寸法。BaseLayout の og:image:width / og:image:height と生成側を一致させるための公開定数。 */
export const OG_IMAGE_WIDTH = WIDTH;
export const OG_IMAGE_HEIGHT = HEIGHT;

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
        `<tspan x="100" dy="${index === 0 ? 0 : 76}">${escapeXml(line)}</tspan>`
    )
    .join("");

  const footer = options.date ? `${formatDate(options.date)} / ${site.name}` : site.description;
  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="14%" cy="-10%" r="90%">
      <stop offset="0" stop-color="#11d9d9" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#11d9d9" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="34" height="34" patternUnits="userSpaceOnUse">
      <path d="M34 0H0V34" fill="none" stroke="#2c3b59" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#1f2d40"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grid)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
  <rect x="60" y="56" width="1080" height="518" rx="10" fill="#2c3b59" stroke="#515d73"/>
  <circle cx="96" cy="90" r="7" fill="#f2c5bb"/>
  <circle cx="120" cy="90" r="7" fill="#f2d7b6"/>
  <circle cx="144" cy="90" r="7" fill="#11d9d9"/>
  <text x="100" y="152" fill="#11d9d9" font-size="26" font-family="Menlo, Consolas, monospace">$ ~/${escapeXml(category)}</text>
  <text x="100" y="280" fill="#f2f2f2" font-size="56" font-weight="600" font-family="Hiragino Sans, Noto Sans JP, sans-serif">${titleSpans}</text>
  <text x="100" y="520" fill="#f2d7b6" font-size="24" font-family="Menlo, Consolas, monospace">${escapeXml(footer)}</text>
  <text x="1048" y="520" fill="#11d9d9" font-size="24" font-family="Menlo, Consolas, monospace">█</text>
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
