/**
 * E2E 用に writer をローカル起動する。
 * 静的アセットを用意し、wrangler dev をローカル KV（状態は一時ディレクトリ、
 * 実行ごとに空）で立ち上げる。本番には一切繋がない。
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const writerDir = path.join(root, "tools", "writer-cloudflare");

if (!existsSync(path.join(writerDir, "node_modules"))) {
  execFileSync("pnpm", ["install"], { cwd: writerDir, stdio: "inherit" });
}
execFileSync("node", [path.join(writerDir, "scripts", "prepare-assets.mjs")], {
  stdio: "inherit"
});

const stateDir = mkdtempSync(path.join(tmpdir(), "slytxt-e2e-writer-"));
const child = spawn(
  "npx",
  ["-y", "wrangler@latest", "dev", "--port", "8787", "--persist-to", stateDir],
  {
    cwd: writerDir,
    stdio: "inherit",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" }
  }
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
