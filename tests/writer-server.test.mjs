import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(root, "tools", "writer", "server.mjs");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startServer() {
  const drafts = await mkdtemp(path.join(tmpdir(), "slytxt-server-"));
  const port = 4600 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, [serverPath, String(port)], {
    cwd: root,
    env: { ...process.env, SLYTXT_DRAFTS_DIR: drafts },
    stdio: ["ignore", "ignore", "pipe"]
  });

  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await fetch(`${base}/api/meta`).then((res) => res.ok).catch(() => false);
    if (ready) {
      return {
        base,
        stop: async () => {
          child.kill("SIGKILL");
          await rm(drafts, { recursive: true, force: true });
        }
      };
    }
    await sleep(50);
  }
  child.kill("SIGKILL");
  throw new Error("執筆サーバーが起動しませんでした");
}

test("server: 別オリジンからの書き込みを拒む", async (t) => {
  const server = await startServer();
  t.after(server.stop);

  const client = { "content-type": "application/json", "x-slytxt-client": "1" };
  const post = (headers, title) =>
    fetch(`${server.base}/api/drafts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title, category: "tech" })
    });

  // 独自ヘッダが無いものは、オリジンが同じでも書き込めない。
  const noHeader = await post({ "content-type": "application/json" }, "ヘッダ無し");
  assert.equal(noHeader.status, 403);

  // フォーム送信で使われる text/plain も、独自ヘッダが無ければ弾く。
  const formPost = await post({ "content-type": "text/plain" }, "フォームから");
  assert.equal(formPost.status, 403);

  // 別オリジンは、ヘッダが揃っていても拒む。
  const foreign = await post({ ...client, origin: "https://evil.example" }, "よそから");
  assert.equal(foreign.status, 403);

  const sameOrigin = await post({ ...client, origin: server.base }, "自分の画面から");
  assert.equal(sameOrigin.status, 201);

  const cli = await post(client, "コマンドから");
  assert.equal(cli.status, 201);

  const listed = await fetch(`${server.base}/api/drafts`).then((res) => res.json());
  assert.equal(listed.drafts.length, 2);
});
