import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractThemeCss } from "../tools/writer-cloudflare/scripts/theme-css.mjs";

test("theme.css にはトップレベルの :root と :root.light だけが入る", () => {
  const css = [
    ":root {\n  --bg: #05070f;\n}\n",
    ":root.light {\n  --bg: #eef3fb;\n}\n",
    "@media print {\n  :root,\n  :root.light {\n    --bg: #ffffff;\n  }\n}\n"
  ].join("\n");
  const theme = extractThemeCss(css);
  assert.equal((theme.match(/:root/g) ?? []).length, 2);
  assert.ok(theme.includes("--bg: #05070f;"));
  assert.ok(theme.includes("--bg: #eef3fb;"));
  assert.ok(!theme.includes("#ffffff"));
});

test("theme.css は実際の global.css の通常テーマと一致し、印刷用パレットを含まない", async () => {
  const globalCss = await readFile(new URL("../src/styles/global.css", import.meta.url), "utf8");
  const theme = extractThemeCss(globalCss);
  assert.equal((theme.match(/:root(?:\.light)?\s*\{/g) ?? []).length, 2);
  assert.ok(theme.includes("--bg: #05070f;"));
  assert.ok(theme.includes("--bg: #eef3fb;"));
  assert.ok(!theme.includes("--bg: #ffffff;"));
  assert.ok(!theme.includes("--shadow: transparent;"));
});
