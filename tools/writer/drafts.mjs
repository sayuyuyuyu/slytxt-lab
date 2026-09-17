/**
 * 執筆用ドラフトの保管庫。
 * `drafts/<id>.md` を1記事1ファイルで扱う。リポジトリ直下だが .gitignore 済み。
 * 別の場所に置きたいときは SLYTXT_DRAFTS_DIR を指定する。
 */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.mjs";
import { plainText } from "./markdown.mjs";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const draftsDir = process.env.SLYTXT_DRAFTS_DIR
  ? path.resolve(process.env.SLYTXT_DRAFTS_DIR)
  : path.join(repoRoot, "drafts");
export const historyDir = path.join(draftsDir, ".history");

export const CATEGORIES = ["tech", "life", "projects"];
export const CATEGORY_LABELS = { tech: "技術メモ", life: "日々の記録", projects: "つくったもの" };
export const STATUSES = ["memo", "draft", "ready", "published"];
export const STATUS_LABELS = { memo: "メモ", draft: "下書き", ready: "出せる", published: "PR済み" };

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

export function assertId(id) {
  if (typeof id !== "string" || !ID_PATTERN.test(id) || id.includes("..")) {
    throw new Error(`ドラフト名として使えない値です: ${JSON.stringify(id)}`);
  }
  return id;
}

export function draftPath(id) {
  return path.join(draftsDir, `${assertId(id)}.md`);
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asTags(value) {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,、]/)
      .map((tag) => tag.trim().replace(/^#/, ""))
      .filter(Boolean);
  }
  return [];
}

export function normalizeDraft(id, data, body) {
  const category = CATEGORIES.includes(asString(data.category)) ? String(data.category) : "tech";
  const status = STATUSES.includes(asString(data.status)) ? String(data.status) : "memo";
  return {
    id,
    title: asString(data.title).trim() || "無題",
    category,
    status,
    tags: asTags(data.tags),
    created: asString(data.created) || nowIso(),
    updated: asString(data.updated) || nowIso(),
    pr: asString(data.pr) || "",
    body: String(body ?? "")
  };
}

export function serializeDraft(draft) {
  return stringifyFrontmatter(
    {
      title: draft.title,
      category: draft.category,
      status: draft.status,
      tags: draft.tags,
      created: draft.created,
      updated: draft.updated,
      pr: draft.pr || undefined
    },
    draft.body
  );
}

export async function ensureDraftsDir() {
  await mkdir(draftsDir, { recursive: true });
}

export async function listDrafts() {
  await ensureDraftsDir();
  const names = await readdir(draftsDir).catch(() => []);
  const drafts = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const id = name.slice(0, -3);
    if (!ID_PATTERN.test(id)) continue;
    try {
      const draft = await readDraft(id);
      drafts.push({
        id: draft.id,
        title: draft.title,
        category: draft.category,
        status: draft.status,
        tags: draft.tags,
        updated: draft.updated,
        pr: draft.pr,
        excerpt: plainText(draft.body).slice(0, 120),
        chars: draft.body.length
      });
    } catch {
      // 壊れたファイルは一覧から落とすだけにして、他を開けなくしない。
    }
  }
  return drafts.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

export async function readDraft(id) {
  const source = await readFile(draftPath(id), "utf8");
  const { data, body } = parseFrontmatter(source);
  return normalizeDraft(assertId(id), data, body);
}

export async function writeDraft(id, patch) {
  const current = await readDraft(id).catch(() => null);
  const base = current ?? normalizeDraft(assertId(id), {}, "");
  const next = normalizeDraft(assertId(id), {
    title: patch.title ?? base.title,
    category: patch.category ?? base.category,
    status: patch.status ?? base.status,
    tags: patch.tags ?? base.tags,
    created: base.created,
    updated: nowIso(),
    pr: patch.pr ?? base.pr
  }, patch.body ?? base.body);
  await ensureDraftsDir();
  await writeFile(draftPath(id), serializeDraft(next), "utf8");
  return next;
}

function slugFragment(title) {
  const ascii = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return ascii || "memo";
}

export async function createDraft({ title = "", category = "tech" } = {}) {
  await ensureDraftsDir();
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${stamp}-${slugFragment(title)}`;
  let id = base;
  let suffix = 2;
  while (await stat(draftPath(id)).catch(() => null)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return writeDraft(id, {
    title: title || "無題",
    category,
    status: "memo",
    tags: [],
    body: ""
  });
}

export async function deleteDraft(id) {
  const target = draftPath(id);
  if (!(await stat(target).catch(() => null))) return false;
  await snapshotDraft(id, "deleted");
  await rm(target);
  return true;
}

/** 上書き前に退避する。expand や publish のように本文を置き換える操作の直前に呼ぶ。 */
export async function snapshotDraft(id, reason = "snapshot") {
  const source = draftPath(id);
  if (!(await stat(source).catch(() => null))) return null;
  await mkdir(historyDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(historyDir, `${assertId(id)}.${stamp}.${reason}.md`);
  await cp(source, target);
  return target;
}
