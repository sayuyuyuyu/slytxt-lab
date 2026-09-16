/** Disposable copy: test content never enters the source checkout or its dist. */
import { cp, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = await mkdtemp(path.join(tmpdir(), "slytxt-ui-"));
for (const name of [
  "src",
  "public",
  "scripts",
  "tests",
  "package.json",
  "pnpm-lock.yaml",
  "astro.config.mjs",
  "tsconfig.json",
]) {
  await cp(path.join(root, name), path.join(target, name), { recursive: true });
}
await symlink(
  path.join(root, "node_modules"),
  path.join(target, "node_modules"),
  "dir",
);
for (const collection of ["tech", "life", "projects"])
  await mkdir(path.join(target, "src/content", collection), {
    recursive: true,
  });
const body =
  '\n## 準備\n\n検証用の文章です。検索確認語は fixturekeyboard。\n\n- 手順を確認する\n- コードを実行する\n\n### 実行例\n\n```ts\nconst message = "hello";\nconsole.log(message);\n```\n\n## 結果\n\n| 項目 | 結果 |\n| --- | --- |\n| 表示 | 確認済み |\n\n[長いURL](https://example.com/a-very-long-path-that-should-wrap-on-a-small-screen-without-horizontal-overflow)\n';
for (let index = 1; index <= 12; index++) {
  await writeFile(
    path.join(target, `src/content/tech/check-${index}.md`),
    `---\ntitle: "技術メモの表示確認 ${index}：日本語の長い見出しとコードを小さな画面でも読みやすくする"\ndescription: "一覧、タグ、検索、ページ送りを検証するための一時的な記事です。"\npublished: 2026-08-${String(index).padStart(2, "0")}\ntags: [Astro, 日本語, とても長いタグをスマートフォンで確認するための検証]\n---\n${body}`,
  );
}
await writeFile(
  path.join(target, "src/content/life/journal.md"),
  `---\ntitle: 日々の記録の表示確認\ndescription: 日々のページを確認します。\npublished: 2026-08-20\ntags: [日本語]\n---\n${body}`,
);
await writeFile(
  path.join(target, "src/content/life/consent.md"),
  `---\ntitle: 閲覧確認の動作テスト\ndescription: 同意ボタンの動作を検証する記事です。\npublished: 2026-08-21\nadult: true\ntags: [検証]\n---\n${body}`,
);
await writeFile(
  path.join(target, "src/content/projects/example.md"),
  `---\ntitle: 完成した制作物の表示確認\ndescription: 完成済みの制作物もトップに表示されます。\nstarted: 2026-08-15\nstatus: completed\nrepo: https://example.com/repository\ntags: [Astro]\n---\n${body}`,
);
await writeFile(
  path.join(target, "src/content/tech/draft.md"),
  "---\ntitle: 非公開の下書き\ndescription: 公開されないことを確認\npublished: 2026-08-25\ndraft: true\n---\nuniquedraftshouldneverappear\n",
);
console.log(target);
