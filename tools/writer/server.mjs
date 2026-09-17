/**
 * 執筆用のローカルサーバー。
 * ブラウザでメモを書いて、AIで膨らませて、整形して Pull Request まで出す。
 *
 *   node tools/writer/server.mjs            # 127.0.0.1:4326
 *   node tools/writer/server.mjs --host     # Tailscale などから触れるようにする
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentPlan, runAgent, stripCodeFence } from "./agent.mjs";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  draftsDir,
  createDraft,
  deleteDraft,
  listDrafts,
  readDraft,
  repoRoot,
  snapshotDraft,
  STATUSES,
  STATUS_LABELS,
  writeDraft
} from "./drafts.mjs";
import { expandPrompt } from "./prompt.mjs";
import { PublishError, publishDraft } from "./publish.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.join(here, "ui");

const args = process.argv.slice(2);
const remote = args.includes("--host");
const portArg = args.find((arg) => /^\d+$/.test(arg));
const port = Number(process.env.PORT ?? portArg ?? 4326);
const host = remote ? "0.0.0.0" : "127.0.0.1";
const token = remote ? (process.env.SLYTXT_TOKEN ?? randomBytes(9).toString("hex")) : "";

const STATIC_FILES = {
  "/": ["ui/index.html", "text/html; charset=utf-8"],
  "/index.html": ["ui/index.html", "text/html; charset=utf-8"],
  "/app.js": ["ui/app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["ui/style.css", "text/css; charset=utf-8"],
  "/markdown.mjs": ["markdown.mjs", "text/javascript; charset=utf-8"]
};

let themeCache = null;

async function themeCss() {
  const file = path.join(repoRoot, "src", "styles", "global.css");
  const info = await stat(file);
  if (themeCache && themeCache.mtime === info.mtimeMs) return themeCache.css;
  const source = await readFile(file, "utf8");
  const css = [...source.matchAll(/:root(?:\.dark)?\s*\{[^}]*\}/g)].map((match) => match[0]).join("\n");
  themeCache = { mtime: info.mtimeMs, css };
  return css;
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

async function readJsonBody(req, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("リクエストが大きすぎます");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function streamTask(res, task) {
  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive"
  });
  const send = (payload) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(payload)}\n`);
  };
  task(send)
    .then((result) => {
      send({ type: "done", result });
      res.end();
    })
    .catch((error) => {
      send({ type: "error", message: error?.message ?? String(error) });
      res.end();
    });
}

function authorized(req, url) {
  if (!token) return true;
  const provided = url.searchParams.get("token") ?? req.headers["x-slytxt-token"];
  if (provided === token) {
    return true;
  }
  const cookie = req.headers.cookie ?? "";
  return cookie.split(/;\s*/).includes(`slytxt_token=${token}`);
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * 他のサイトから書き込みAPIを叩かせない。
 * 書き込みはブラウザからしか使わないので、Origin があれば Host と一致を求め、
 * Origin が無い相手（curl など）には JSON を要求する。
 * text/plain のフォーム送信で、気づかないうちに publish が走るのを防ぐ。
 */
function crossSiteRequest(req) {
  const origin = req.headers.origin;
  if (!origin) {
    return !String(req.headers["content-type"] ?? "").includes("application/json");
  }
  try {
    return new URL(origin).host !== (req.headers.host ?? "");
  } catch {
    return true;
  }
}

async function handleApi(req, res, url) {
  const segments = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const [, resource, id, action] = segments;
  const method = req.method ?? "GET";

  if (resource === "meta" && method === "GET") {
    json(res, 200, {
      categories: CATEGORIES,
      categoryLabels: CATEGORY_LABELS,
      statuses: STATUSES,
      statusLabels: STATUS_LABELS,
      draftsDir,
      agent: agentPlan().label
    });
    return true;
  }

  if (resource === "drafts" && !id) {
    if (method === "GET") {
      json(res, 200, { drafts: await listDrafts() });
      return true;
    }
    if (method === "POST") {
      const body = await readJsonBody(req);
      const draft = await createDraft({ title: body.title ?? "", category: body.category ?? "tech" });
      json(res, 201, { draft });
      return true;
    }
    return false;
  }

  if (resource === "drafts" && id && !action) {
    if (method === "GET") {
      json(res, 200, { draft: await readDraft(id) });
      return true;
    }
    if (method === "PUT") {
      const body = await readJsonBody(req);
      const draft = await writeDraft(id, body);
      json(res, 200, { draft });
      return true;
    }
    if (method === "DELETE") {
      const removed = await deleteDraft(id);
      json(res, removed ? 200 : 404, { removed });
      return true;
    }
    return false;
  }

  if (resource === "expand" && id && method === "POST") {
    streamTask(res, async (send) => {
      const draft = await readDraft(id);
      if (!draft.body.trim()) throw new Error("本文が空です。メモを書いてから実行してください。");
      send({ type: "log", message: "元のメモを退避しています" });
      await snapshotDraft(id, "expand");
      const { stdout } = await runAgent({
        prompt: await expandPrompt(draft),
        onLog: (message) => send({ type: "log", message })
      });
      const body = stripCodeFence(stdout);
      if (!body.trim()) throw new Error("エージェントの出力が空でした");
      const updated = await writeDraft(id, {
        body,
        status: draft.status === "memo" ? "draft" : draft.status
      });
      send({ type: "log", message: "下書きに反映しました" });
      return { draft: updated };
    });
    return true;
  }

  if (resource === "publish" && id && method === "POST") {
    streamTask(res, async (send) => {
      const result = await publishDraft({
        id,
        onLog: (message) => send({ type: "log", message })
      });
      return result;
    });
    return true;
  }

  return false;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (!authorized(req, url)) {
    res.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
    res.end("トークンが必要です。起動時に表示された URL を開いてください。");
    return;
  }
  if (STATE_CHANGING.has(req.method ?? "") && crossSiteRequest(req)) {
    json(res, 403, {
      error: "別のオリジンからの書き込みは受け付けません。執筆画面から操作してください。"
    });
    return;
  }
  if (token && url.searchParams.get("token") === token) {
    res.setHeader("set-cookie", `slytxt_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  }

  try {
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (!handled) json(res, 404, { error: "not found" });
      return;
    }

    if (url.pathname === "/theme.css") {
      res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-store" });
      res.end(await themeCss());
      return;
    }

    const entry = STATIC_FILES[url.pathname];
    if (entry) {
      const [relative, type] = entry;
      const file = path.join(here, relative);
      const content = await readFile(file).catch(() => null);
      if (!content) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      res.end(content);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    json(res, error instanceof PublishError ? 400 : 500, { error: error?.message ?? String(error) });
  }
});

server.listen(port, host, () => {
  const suffix = token ? `/?token=${token}` : "/";
  console.log("執筆サーバーを起動しました");
  console.log(`  http://127.0.0.1:${port}${suffix}`);
  if (remote) {
    console.log("  外部からは http://<このマシンのアドレス>:" + port + suffix);
    console.log("  別のアドレスで開くときは起動時に表示された token が必要です");
  }
  console.log(`  ドラフト: ${draftsDir}`);
  console.log(`  エージェント: ${agentPlan().label}`);
});
