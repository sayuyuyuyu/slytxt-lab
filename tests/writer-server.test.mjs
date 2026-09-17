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

  const foreign = await fetch(`${server.base}/api/drafts`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ title: "よそから", category: "tech" })
  });
  assert.equal(foreign.status, 403);

  // Origin が無くても、フォーム送信で使われる text/plain は弾く。
  const formPost = await fetch(`${server.base}/api/drafts`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ title: "フォームから", category: "tech" })
  });
  assert.equal(formPost.status, 403);

  const sameOrigin = await fetch(`${server.base}/api/drafts`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: server.base },
    body: JSON.stringify({ title: "自分の画面から", category: "tech" })
  });
  assert.equal(sameOrigin.status, 201);

  // Origin の無い CLI からの JSON は通す。
  const cli = await fetch(`${server.base}/api/drafts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "コマンドから", category: "tech" })
  });
  assert.equal(cli.status, 201);

  const listed = await fetch(`${server.base}/api/drafts`).then((res) => res.json());
  assert.equal(listed.drafts.length, 2);
});
