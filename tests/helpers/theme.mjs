import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/** DADS の文字サイズ（#854）。トークンはこの集合から選ぶ。 */
export const TYPE_SCALE_PX = [14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 45];

const TOKEN_PX = {
  xs: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 28,
  "4xl": 32,
  "5xl": 36
};

/** `clamp()` は最小値、`var(--text-*)` はスケール、rem/px は実寸で見る。 */
export function fontSizePx(value) {
  const text = value.trim();
  const clamp = text.match(/^clamp\((.+)\)$/);
  if (clamp) return fontSizePx(clamp[1].split(",")[0].trim());
  const token = text.match(/^var\(--text-([a-z0-9]+)\)$/);
  if (token) return TOKEN_PX[token[1]] ?? null;
  const rem = text.match(/^([\d.]+)rem$/);
  if (rem) return Number(rem[1]) * 16;
  const px = text.match(/^([\d.]+)px$/);
  if (px) return Number(px[1]);
  // em などの相対値は親に依存するので、ここでは判定しない。
  return null;
}

const HEX = /^#[0-9a-f]{6}$/i;

function blockVars(block) {
  return new Map(
    [...block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

/** global.css の色の値を hex にする（`var()` と `color-mix(in srgb, …)` だけ解く）。 */
export function resolveColor(value, vars) {
  const text = String(value ?? "").trim();
  if (HEX.test(text)) return text.toLowerCase();
  const varMatch = text.match(/^var\(--([\w-]+)\)$/);
  if (varMatch) return resolveColor(vars.get(varMatch[1]), vars);
  const mixMatch = text.match(/^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)$/);
  if (mixMatch) {
    const first = resolveColor(mixMatch[1], vars).slice(1);
    const second = resolveColor(mixMatch[3], vars).slice(1);
    const ratio = Number(mixMatch[2]) / 100;
    const channels = [0, 2, 4].map((i) => {
      const a = Number.parseInt(first.slice(i, i + 2), 16);
      const b = Number.parseInt(second.slice(i, i + 2), 16);
      return Math.round(a * ratio + b * (1 - ratio))
        .toString(16)
        .padStart(2, "0");
    });
    return `#${channels.join("")}`;
  }
  throw new Error(`解けない色: ${text}`);
}

function luminance(hex) {
  const channel = (offset) => {
    const value = Number.parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG のコントラスト比（1〜21）。 */
export function contrastRatio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** global.css の `:root`（パレット・ダーク）と `:root.light` を、それぞれ役割の色に解決する。 */
export async function themeColors(cssText) {
  // 行頭の :root（パレット）, :root（ダーク）, :root.light の3ブロック。
  // @media print の中の :root は字下げされているので拾わない。
  const blocks = [...cssText.matchAll(/^:root(\.light)?\s*\{([^}]*)\}/gm)];
  assert.equal(blocks.length, 3, "global.css の :root ブロックが3つではない");
  const palette = blockVars(blocks[0][2]);
  const rolesOf = (index) => {
    const vars = new Map([...palette, ...blockVars(blocks[index][2])]);
    return {
      bg: resolveColor(vars.get("bg"), vars),
      text: resolveColor(vars.get("text"), vars),
      muted: resolveColor(vars.get("text-muted"), vars),
      accent: resolveColor(vars.get("accent"), vars),
      state: {
        red: resolveColor(vars.get("accent-red"), vars),
        warn: resolveColor(vars.get("accent-warn"), vars)
      }
    };
  };
  return { dark: rolesOf(1), light: rolesOf(2) };
}

export async function readGlobalCss() {
  return readFile(new URL("../../src/styles/global.css", import.meta.url), "utf8");
}
