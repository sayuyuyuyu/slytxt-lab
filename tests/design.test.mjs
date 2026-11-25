import assert from "node:assert/strict";
import test from "node:test";
import {
  TYPE_SCALE_PX,
  contrastRatio,
  fontSizePx,
  readGlobalCss,
  themeColors
} from "./helpers/theme.mjs";

test("design: 文字サイズは DADS のスケール（14〜36px）に載っている", async () => {
  const css = await readGlobalCss();
  // 役割の色（--text-muted など）と区別するため、スケールの名前だけを見る。
  const scaleNames = new Set(["xs", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl"]);
  const tokens = [...css.matchAll(/--text-([a-z0-9]+):\s*([^;]+);/g)]
    .filter((m) => scaleNames.has(m[1]))
    .map((m) => ({ name: m[1], px: fontSizePx(m[2]) }));
  assert.ok(tokens.length >= 5);
  for (const token of tokens) {
    assert.ok(token.px, `--text-${token.name} のサイズを解けない`);
    assert.ok(
      TYPE_SCALE_PX.includes(token.px),
      `--text-${token.name} は ${token.px}px。DADS のスケール（${TYPE_SCALE_PX.join(", ")}）に無い`
    );
  }
});

test("design: 14px 未満の文字サイズを使わない", async () => {
  const css = await readGlobalCss();
  const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(sizes.length > 0);
  for (const value of sizes) {
    if (value.endsWith("em") && !value.endsWith("rem")) continue; // 相対値は対象外
    const px = fontSizePx(value);
    assert.ok(px, `サイズを解けない: ${value}`);
    assert.ok(px >= 14, `14px 未満の文字サイズ: ${value}（${px}px）`);
  }
});

test("design: 本文とリンクの色はダーク・ライトとも 4.5:1 以上ある", async () => {
  const { dark, light } = await themeColors(await readGlobalCss());
  for (const [name, colors] of Object.entries({ dark, light })) {
    const text = contrastRatio(colors.text, colors.bg);
    const muted = contrastRatio(colors.muted, colors.bg);
    const accent = contrastRatio(colors.accent, colors.bg);
    assert.ok(text >= 4.5, `${name}: text ${text.toFixed(2)}`);
    assert.ok(muted >= 4.5, `${name}: text-muted ${muted.toFixed(2)}`);
    assert.ok(accent >= 4.5, `${name}: accent ${accent.toFixed(2)}`);
  }
});

test("design: 状態色（注意・警告）も背景に対して 4.5:1 以上ある", async () => {
  const { dark, light } = await themeColors(await readGlobalCss());
  for (const [name, colors] of Object.entries({ dark, light })) {
    for (const [role, hex] of Object.entries(colors.state)) {
      const ratio = contrastRatio(hex, colors.bg);
      assert.ok(ratio >= 4.5, `${name}: ${role} ${ratio.toFixed(2)}`);
    }
  }
});

test("design: フォーカス表示は DADS の作法（2px 以上＋十分なコントラスト）", async () => {
  const css = await readGlobalCss();
  const rule = css.match(/:focus-visible\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /outline:\s*(?:[2-9]|1\d)px solid/, "フォーカスリングの輪郭が 2px 以上ではない");
  assert.match(rule, /outline-offset:/, "フォーカスリングが要素から離れていない");
  assert.match(rule, /box-shadow:/, "内側のリングが無い");
});
