/**
 * 執筆用ドラフトの保管庫（Cloudflare KV 版）。
 *
 * キーは `draft:<id>`、値は移行前のファイル保存版が drafts/<id>.md に
 * 書いていたテキストそのもの。置き場所だけがファイルから KV に変わり、
 * API 形状・直列化形式は移行時から変えていない。
 */
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.mjs";
import { plainText, textLength, truncateText } from "./markdown.mjs";

export const CATEGORIES = ["tech", "journal", "notes"];
export const CATEGORY_LABELS = { tech: "Tech", journal: "Journal", notes: "Notes" };

export class DraftNotFound extends Error {}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const KEY_PREFIX = "draft:";

export function assertId(id) {
  if (typeof id !== "string" || !ID_PATTERN.test(id) || id.includes("..")) {
    throw new Error(`ドラフト名として使えない値です: ${JSON.stringify(id)}`);
  }
  return id;
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

const MANAGED_KEYS = new Set([
  "title",
  "description",
  "category",
  "tags",
  "cover",
  "created",
  "updated",
  "pr",
  "slug"
]);

/**
 * ドラフトが自分で書くキー以外と、解釈できなかった行を残す。
 * エディタから保存したときに、手で足したキーやコメントを消さないため。
 * （移行前のファイル保存版と同じ規則）
 */
function carriedLines(raw = []) {
  return raw.filter((line) => {
    if (String(line).trim() === "") return false;
    const key = String(line).match(/^([A-Za-z0-9_-]+):/)?.[1];
    return key ? !MANAGED_KEYS.has(key) : true;
  });
}

export function normalizeDraft(id, data, body, raw = []) {
  // 旧 life カテゴリのメモは journal として扱う。
  const rawCategory = asString(data.category);
  const category =
    rawCategory === "life"
      ? "journal"
      : CATEGORIES.includes(rawCategory)
        ? rawCategory
        : "tech";
  return {
    id,
    title: asString(data.title).trim() || "無題",
    description: asString(data.description),
    category,
    tags: asTags(data.tags),
    cover: asString(data.cover),
    created: asString(data.created) || nowIso(),
    updated: asString(data.updated) || nowIso(),
    pr: asString(data.pr) || "",
    slug: asString(data.slug) || "",
    extras: carriedLines(raw),
    body: String(body ?? "")
  };
}

export function serializeDraft(draft) {
  return stringifyFrontmatter(
    {
      title: draft.title,
      description: draft.description || undefined,
      category: draft.category,
      tags: draft.tags,
      cover: draft.cover || undefined,
      created: draft.created,
      updated: draft.updated,
      pr: draft.pr || undefined,
      slug: draft.slug || undefined
    },
    draft.body,
    draft.extras ?? []
  );
}

function slugFragment(title) {
  const ascii = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return ascii || "memo";
}

/**
 * KV バインディングを受け取って、ファイル保存版と同じ関数群を返す。
 * KV には排他作成がないため、createDraft の競合窓は
 * 「存在確認 → 書き込み」の間だけ残る（単独利用では実害なし）。
 */
export function createDraftStore(kv) {
  const keyOf = (id) => `${KEY_PREFIX}${assertId(id)}`;

  async function readDraft(id) {
    const source = await kv.get(keyOf(id));
    if (source == null) throw new DraftNotFound(`ドラフト ${assertId(id)} はありません`);
    const { data, body, raw } = parseFrontmatter(source);
    return normalizeDraft(assertId(id), data, body, raw);
  }

  async function listDrafts() {
    const drafts = [];
    let cursor = undefined;
    for (;;) {
      const page = await kv.list({ prefix: KEY_PREFIX, cursor });
      for (const entry of page.keys) {
        const id = entry.name.slice(KEY_PREFIX.length);
        if (!ID_PATTERN.test(id)) continue;
        try {
          const draft = await readDraft(id);
          drafts.push({
            id: draft.id,
            title: draft.title,
            category: draft.category,
            tags: draft.tags,
            updated: draft.updated,
            pr: draft.pr,
            excerpt: truncateText(plainText(draft.body), 120),
            chars: textLength(draft.body)
          });
        } catch {
          // 壊れたレコードは一覧から落とすだけにして、他を開けなくしない。
        }
      }
      if (page.list_complete) break;
      cursor = page.cursor;
    }
    return drafts.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  }

  async function writeDraft(id, patch) {
    const current = await readDraft(id).catch(() => null);
    // 存在しないドラフトを保存で作り直さない（ファイル保存版と同じ）。
    if (!current) throw new DraftNotFound(`ドラフト ${assertId(id)} はありません`);
    const base = current;
    const next = normalizeDraft(
      assertId(id),
      {
        title: patch.title ?? base.title,
        description: patch.description ?? base.description,
        category: patch.category ?? base.category,
        tags: patch.tags ?? base.tags,
        cover: patch.cover ?? base.cover,
        created: base.created,
        updated: nowIso(),
        pr: patch.pr ?? base.pr,
        slug: patch.slug ?? base.slug
      },
      patch.body ?? base.body,
      base.extras
    );
    await kv.put(keyOf(id), serializeDraft(next));
    return next;
  }

  async function createDraft({ title = "", category = "notes" } = {}) {
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `${stamp}-${slugFragment(title)}`;
    let id = base;
    let suffix = 2;
    for (;;) {
      if ((await kv.get(keyOf(id))) == null) {
        const draft = normalizeDraft(id, { title: title || "無題", category }, "");
        await kv.put(keyOf(id), serializeDraft(draft));
        return draft;
      }
      id = `${base}-${suffix}`;
      suffix += 1;
    }
  }

  async function deleteDraft(id) {
    if ((await kv.get(keyOf(id))) == null) return false;
    await kv.delete(keyOf(id));
    return true;
  }

  return { listDrafts, readDraft, writeDraft, createDraft, deleteDraft };
}
