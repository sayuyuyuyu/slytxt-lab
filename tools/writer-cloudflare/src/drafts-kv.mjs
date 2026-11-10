/**
 * 執筆用ドラフトの保管庫（Cloudflare KV 版）。
 *
 * キーは `draft:<id>`、値は移行前のファイル保存版が drafts/<id>.md に
 * 書いていたテキストそのもの。置き場所だけがファイルから KV に変わり、
 * API 形状・直列化形式は移行時から変えていない。
 *
 * 保留中の公開ジョブ（pr が残っている下書き）の ID は、単一キー
 * `pending-publishes` に JSON で保持する。Cron の見届け（driver.mjs）が
 * 毎分 list を呼ぶと無料枠の list 上限（1,000件/日）を単独で超えてしまう
 * ため、一覧スキャンは UI 操作時とインデックス再構築時だけに限る。
 * インデックスは下書きの作成・保存・削除に追随して更新され、欠落・
 * 不完全な場合は list スキャンで再構築する（自己修復）。
 *
 * 下書き一覧も同じ理由で単一キー `draft-index` に ID 一覧を保持する
 * （issue #584）。KV の list 日次上限に達すると /api/drafts と
 * /api/meta が返らず writer 自体が起動しなくなるため、通常の一覧取得は
 * インデックスからの get だけで済ませ、list スキャンはインデックスの
 * 欠落・不完全時の再構築だけに限る。
 */
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.mjs";
import { plainText, textLength, truncateText } from "./markdown.mjs";
import { today } from "./date.mjs";

export const CATEGORIES = ["tech", "journal", "notes"];
export const CATEGORY_LABELS = { tech: "Tech", journal: "Journal", notes: "Notes" };

export class DraftNotFound extends Error {}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const KEY_PREFIX = "draft:";
/** 保留中公開ジョブのインデックスキー。値は { ids: string[], complete: boolean }。 */
const PENDING_KEY = "pending-publishes";
/** 下書き一覧のインデックスキー。値は { ids: string[], complete: boolean }。 */
const DRAFT_INDEX_KEY = "draft-index";

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

/** 一覧表示用の要約（listDrafts / listPendingDrafts 共通）。 */
function summarizeDraft(draft) {
  return {
    id: draft.id,
    title: draft.title,
    category: draft.category,
    tags: draft.tags,
    updated: draft.updated,
    pr: draft.pr,
    excerpt: truncateText(plainText(draft.body), 120),
    chars: textLength(draft.body)
  };
}

function sortSummaries(drafts) {
  return drafts.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
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

  async function readDraftIndex() {
    const raw = await kv.get(DRAFT_INDEX_KEY).catch(() => null);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.ids)) return null;
      return {
        ids: parsed.ids.filter((id) => typeof id === "string" && ID_PATTERN.test(id)),
        complete: parsed.complete === true
      };
    } catch {
      return null;
    }
  }

  async function writeDraftIndex(ids, complete) {
    await kv.put(DRAFT_INDEX_KEY, JSON.stringify({ ids: [...new Set(ids)], complete }));
  }

  /** 作成・保存に追随して下書き一覧インデックスを更新する。 */
  async function syncDraftIndex(id) {
    const index = await readDraftIndex();
    if (!index) {
      await writeDraftIndex([id], false);
      return;
    }
    if (!index.ids.includes(id)) {
      await writeDraftIndex([...index.ids, id], index.complete);
    }
  }

  async function dropFromDraftIndex(id) {
    const index = await readDraftIndex();
    if (!index || !index.ids.includes(id)) return;
    await writeDraftIndex(
      index.ids.filter((entry) => entry !== id),
      index.complete
    );
  }

  async function listDraftsViaScan() {
    const drafts = [];
    let cursor = undefined;
    for (;;) {
      const page = await kv.list({ prefix: KEY_PREFIX, cursor });
      for (const entry of page.keys) {
        const id = entry.name.slice(KEY_PREFIX.length);
        if (!ID_PATTERN.test(id)) continue;
        try {
          drafts.push(summarizeDraft(await readDraft(id)));
        } catch {
          // 壊れたレコードは一覧から落とすだけにして、他を開けなくしない。
        }
      }
      if (page.list_complete) break;
      cursor = page.cursor;
    }
    return sortSummaries(drafts);
  }

  /**
   * 下書き一覧。インデックスが完全なら get だけで返し、list は呼ばない。
   * インデックスが欠落・不完全なときだけ list スキャンで再構築する。
   */
  async function listDrafts() {
    const index = await readDraftIndex();
    if (!index || !index.complete) {
      const drafts = await listDraftsViaScan();
      await writeDraftIndex(
        drafts.map((draft) => draft.id),
        true
      ).catch(() => {});
      return drafts;
    }
    const drafts = [];
    const stale = [];
    for (const id of index.ids) {
      try {
        drafts.push(summarizeDraft(await readDraft(id)));
      } catch (error) {
        if (error instanceof DraftNotFound) stale.push(id);
        // 壊れたレコードは一覧から落とすだけ（インデックスには残す）。
      }
    }
    if (stale.length) {
      await writeDraftIndex(
        index.ids.filter((id) => !stale.includes(id)),
        true
      ).catch(() => {});
    }
    return sortSummaries(drafts);
  }

  /**
   * 保留中インデックスを読む。欠落・破損時は null。
   * complete が false のインデックスは「一部の ID しか入っていない
   * かもしれない」状態で、次回の listPendingDrafts で再構築される。
   */
  async function readPendingIndex() {
    const raw = await kv.get(PENDING_KEY).catch(() => null);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.ids)) return null;
      return {
        ids: parsed.ids.filter((id) => typeof id === "string" && ID_PATTERN.test(id)),
        complete: parsed.complete === true
      };
    } catch {
      return null;
    }
  }

  async function writePendingIndex(ids, complete) {
    await kv.put(PENDING_KEY, JSON.stringify({ ids: [...new Set(ids)], complete }));
  }

  /** 保存・削除に追随して保留中インデックスを更新する。 */
  async function syncPendingIndex(draft) {
    const index = await readPendingIndex();
    if (!index) {
      // インデックスが無い間は、保留中の下書きが現れたときだけ
      // 部分インデックスを作る（残りは再構築で埋まる）。
      if (draft.pr) await writePendingIndex([draft.id], false);
      return;
    }
    const has = index.ids.includes(draft.id);
    if (draft.pr && !has) {
      await writePendingIndex([...index.ids, draft.id], index.complete);
    } else if (!draft.pr && has) {
      await writePendingIndex(
        index.ids.filter((id) => id !== draft.id),
        index.complete
      );
    }
  }

  async function dropFromPendingIndex(id) {
    const index = await readPendingIndex();
    if (!index || !index.ids.includes(id)) return;
    await writePendingIndex(
      index.ids.filter((entry) => entry !== id),
      index.complete
    );
  }

  /**
   * 保留中の公開ジョブがある下書きの要約だけを返す（Cron の見届け用）。
   * インデックスが完全なら get だけで済み、list は呼ばない。
   * インデックスが欠落・不完全なときだけ list スキャンで再構築する。
   */
  async function listPendingDrafts() {
    const index = await readPendingIndex();
    if (!index || !index.complete) {
      const all = await listDrafts();
      const pending = all.filter((draft) => draft.pr);
      await writePendingIndex(
        pending.map((draft) => draft.id),
        true
      );
      return pending;
    }
    const drafts = [];
    const stale = [];
    for (const id of index.ids) {
      try {
        const draft = await readDraft(id);
        if (draft.pr) drafts.push(summarizeDraft(draft));
        else stale.push(id);
      } catch (error) {
        if (error instanceof DraftNotFound) stale.push(id);
        else throw error;
      }
    }
    if (stale.length) {
      await writePendingIndex(
        index.ids.filter((id) => !stale.includes(id)),
        true
      ).catch(() => {});
    }
    return sortSummaries(drafts);
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
    await syncDraftIndex(next.id).catch(() => {});
    await syncPendingIndex(next).catch(() => {});
    return next;
  }

  async function createDraft({ title = "", category = "notes" } = {}) {
    const stamp = today();
    const base = `${stamp}-${slugFragment(title)}`;
    let id = base;
    let suffix = 2;
    for (;;) {
      if ((await kv.get(keyOf(id))) == null) {
        const draft = normalizeDraft(id, { title: title || "無題", category }, "");
        await kv.put(keyOf(id), serializeDraft(draft));
        await syncDraftIndex(draft.id).catch(() => {});
        return draft;
      }
      id = `${base}-${suffix}`;
      suffix += 1;
    }
  }

  /**
   * 公開済み記事の取り込み用: ID を指定して下書きを作る。
   * 既に同じ ID の下書きがあれば作り直さず既存を返す（冪等）。
   * data / body / raw の形は normalizeDraft と同じで、管理対象外の
   * frontmatter 行（公開日など）は raw 経由で extras に保持される。
   */
  async function importDraft(id, data, body, raw = []) {
    assertId(id);
    if ((await kv.get(keyOf(id))) != null) return readDraft(id);
    const draft = normalizeDraft(id, data, body, raw);
    await kv.put(keyOf(id), serializeDraft(draft));
    await syncDraftIndex(draft.id).catch(() => {});
    return draft;
  }

  async function deleteDraft(id) {
    if ((await kv.get(keyOf(id))) == null) return false;
    await kv.delete(keyOf(id));
    await dropFromDraftIndex(id).catch(() => {});
    await dropFromPendingIndex(id).catch(() => {});
    return true;
  }

  return {
    listDrafts,
    listPendingDrafts,
    readDraft,
    writeDraft,
    createDraft,
    importDraft,
    deleteDraft
  };
}
