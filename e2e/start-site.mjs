/**
 * E2E 用にサイトをローカル起動する。
 * scripts/prepare-ui-fixture.mjs と同じ流儀で、使い捨てコピーに
 * 埋め込み確認用の記事を足してビルドし、astro preview で配信する。
 * 実コンテンツとチェックアウトには触れない。
 */
import { execFileSync, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = await mkdtemp(path.join(tmpdir(), "slytxt-e2e-site-"));

for (const name of ["src", "public", "package.json", "astro.config.mjs", "tsconfig.json"]) {
  const source = path.join(root, name);
  if (!(await stat(source).catch(() => null))) continue;
  await cp(source, path.join(target, name), { recursive: true });
}
await symlink(path.join(root, "node_modules"), path.join(target, "node_modules"), "dir");
for (const collection of ["tech", "journal", "notes", "projects"]) {
  await mkdir(path.join(target, "src", "content", collection), { recursive: true });
}

// 埋め込み確認用の記事。本文に単独行で置いた Spotify の URL が
// 公開側（remark-embed）でプレイヤーになることを E2E で見る。
await writeFile(
  path.join(target, "src", "content", "journal", "e2e-embed.md"),
  [
    "---",
    "title: E2E 埋め込み確認",
    "description: E2E 用の埋め込み確認記事。",
    "published: 2026-11-04",
    "---",
    "",
    "## 埋め込みテスト",
    "",
    "これはスタイル比較用の段落です。",
    "",
    "https://open.spotify.com/track/5oCptG3RbPTbXKFpVjUgmw",
    ""
  ].join("\n")
);

const bin = (name) => path.join(root, "node_modules", ".bin", name);
execFileSync(bin("astro"), ["build", "--force"], { cwd: target, stdio: "inherit" });
execFileSync(bin("pagefind"), ["--site", "dist", "--glob", "**/*.html"], {
  cwd: target,
  stdio: "inherit"
});

const child = spawn(bin("astro"), ["preview", "--port", "4321", "--host", "127.0.0.1"], {
  cwd: target,
  stdio: "inherit"
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
