import assert from "node:assert/strict";
import test from "node:test";
import {
  branchName,
  contentPath,
  isPublishCategory,
  normalizeSlug,
  publicUrl,
  todayInTokyo
} from "../tools/obsidian-slytxt/src/lib/slug.ts";
import {
  deriveTitle,
  documentBody,
  serializeFrontmatter
} from "../tools/obsidian-slytxt/src/lib/frontmatter.ts";
import { deriveDescription, preparePublish } from "../tools/obsidian-slytxt/src/lib/publish-plan.ts";
import { PublishError, publishNote, toBase64 } from "../tools/obsidian-slytxt/src/lib/github.ts";

/* ---- slug・パス・ブランチ ---- */

test("obsidian: slug は英数字とハイフンにし、作れないときは日付に落とす", () => {
  assert.equal(normalizeSlug("Hello World!", "2026-11-16"), "hello-world");
  assert.equal(normalizeSlug("--a--b--", "2026-11-16"), "a-b");
  assert.equal(normalizeSlug("今日のメモ", "2026-11-16"), "post-20261116");
  assert.equal(normalizeSlug("a".repeat(80), "2026-11-16").length, 60);
});

test("obsidian: カテゴリごとのパス・ブランチ・公開 URL", () => {
  assert.equal(contentPath("misc", "memo"), "src/content/misc/memo.md");
  assert.equal(contentPath("tech", "memo"), "src/content/tech/memo.md");
  assert.equal(branchName("misc", "memo"), "write/memo");
  assert.equal(branchName("comic", "memo"), "write/memo");
  assert.equal(publicUrl("misc", "memo"), "https://slytxt.dev/articles/misc/memo/");
  assert.equal(publicUrl("tech", "memo"), "https://slytxt.dev/articles/tech/memo/");
  assert.equal(publicUrl("comic", "memo"), "https://slytxt.dev/articles/comic/memo/");
  assert.equal(isPublishCategory("projects"), false);
});

test("obsidian: 今日は JST で数える", () => {
  // 2026-11-16T15:30Z は JST では 17日 00:30。
  assert.equal(todayInTokyo(new Date("2026-11-16T15:30:00.000Z")), "2026-11-17");
  assert.equal(todayInTokyo(new Date("2026-11-16T14:30:00.000Z")), "2026-11-16");
});

/* ---- frontmatter ---- */

test("obsidian: frontmatter は固定順で書き、必要な値だけ引用する", () => {
  const yaml = serializeFrontmatter({
    title: "タイトル: コロン入り",
    description: "ふつうの説明",
    published: "2026-11-16",
    tags: ["AI", "AI", " クラウド ", ""],
    cover: "https://media.slytxt.dev/a.jpg"
  });
  assert.deepEqual(yaml.split("\n"), [
    "---",
    'title: "タイトル: コロン入り"',
    "description: ふつうの説明",
    "published: 2026-11-16",
    "tags: [AI, クラウド]",
    "cover: https://media.slytxt.dev/a.jpg",
    "---"
  ]);
});

test("obsidian: タイトル無しは空文字として明示し、タグは10件まで", () => {
  const yaml = serializeFrontmatter({
    title: "",
    description: "",
    published: "2026-11-16",
    tags: Array.from({ length: 12 }, (_, index) => `t${index}`)
  });
  assert.match(yaml, /^---\ntitle: ""\ndescription: ""/);
  assert.match(yaml, /tags: \[t0, t1, t2, t3, t4, t5, t6, t7, t8, t9\]/);
  assert.ok(!yaml.includes("t10"));
});

test("obsidian: 本文は frontmatter の後ろに1つ空行を置いて連結する", () => {
  const doc = documentBody(
    { title: "t", description: "d", published: "2026-11-16", tags: [] },
    "\n\n本文です。\n\n"
  );
  assert.equal(
    doc,
    "---\ntitle: t\ndescription: d\npublished: 2026-11-16\ntags: []\n---\n\n本文です。\n"
  );
});

test("obsidian: タイトルは記事は本文から補い、misc は空にする", () => {
  assert.equal(deriveTitle("tech", "与えた題名", "本文"), "与えた題名");
  assert.equal(deriveTitle("comic", "", "## 見出しの行\n次の行"), "見出しの行");
  assert.equal(deriveTitle("misc", "", "メモの書き出し"), "");
  assert.equal(deriveTitle("tech", "無題", ""), "無題");
  assert.equal([...deriveTitle("tech", "", "あ".repeat(100))].length, 40);
});

test("obsidian: 説明文は本文から作り、長いときは文末で切る", () => {
  assert.equal(deriveDescription("1行目です。\n2行目です。"), "1行目です。 2行目です。");
  assert.equal(deriveDescription("短い"), "短い");
  const long = `${"あ".repeat(50)}。${"い".repeat(80)}`;
  const description = deriveDescription(long);
  assert.ok([...description].length <= 90);
  assert.ok(description.endsWith("。"));
});

test("obsidian: 公開一式（slug・frontmatter・内容）を組み立てる", () => {
  const payload = preparePublish(
    {
      name: "Hello World",
      category: "tech",
      title: "",
      tags: ["AI"],
      body: "最初の行\n\n本文です。"
    },
    "2026-11-16"
  );
  assert.equal(payload.slug, "hello-world");
  assert.equal(payload.title, "最初の行");
  assert.equal(payload.path, "src/content/tech/hello-world.md");
  assert.equal(payload.branch, "write/hello-world");
  assert.equal(payload.frontmatter.published, "2026-11-16");
  assert.equal(payload.frontmatter.description, "最初の行 本文です。");
  assert.ok(payload.content.startsWith("---\ntitle: 最初の行\n"));
  assert.ok(payload.content.endsWith("本文です。\n"));
});

test("obsidian: 既存の公開日があれば引き継ぐ", () => {
  const payload = preparePublish(
    {
      name: "memo",
      category: "misc",
      published: "2026-02-03",
      body: "メモ"
    },
    "2026-11-16"
  );
  assert.equal(payload.frontmatter.published, "2026-02-03");
  assert.equal(payload.frontmatter.title, "");
});

/* ---- GitHub 連携 ---- */

test("obsidian: 日本語の本文も base64 で往復する", () => {
  const encoded = toBase64("日本語の本文");
  assert.equal(Buffer.from(encoded, "base64").toString("utf8"), "日本語の本文");
});

/** GitHub API の代返。呼ばれた順に記録し、用意した応答を返す。 */
function fakeGitHub(responses = {}) {
  const calls = [];
  const request = async ({ url, method, headers, body }) => {
    const entry = { url, method, headers, body: body ? JSON.parse(body) : undefined };
    calls.push(entry);
    const key = `${method} ${url.replace("https://api.github.com/repos/sayuyuyuyu/slytxt-lab", "")}`;
    const canned = responses[key];
    if (typeof canned === "function") return canned(entry);
    if (canned) return { status: canned.status ?? 200, json: canned.json ?? null };
    return { status: 404, json: { message: "Not Found" } };
  };
  return { calls, request };
}

const settings = {
  owner: "sayuyuyuyu",
  repo: "slytxt-lab",
  token: "tok",
  baseBranch: "main"
};

const publishInput = {
  category: "comic",
  slug: "hello-world",
  title: "Hello World",
  content: "---\ntitle: Hello World\n---\n\n本文\n"
};

test("obsidian: 公開はブランチ作成→ファイル書き込み→PR の順に進む", async () => {
  const gh = fakeGitHub({
    "GET /git/ref/heads/main": { json: { object: { sha: "base-sha" } } },
    "POST /git/refs": { status: 201, json: { ref: "refs/heads/write/hello-world" } },
    "PUT /contents/src/content/comic/hello-world.md": { status: 201, json: {} },
    "POST /pulls": { status: 201, json: { html_url: "https://github.com/x/y/pull/9", number: 9 } }
  });

  const result = await publishNote(gh.request, settings, publishInput);
  assert.deepEqual(
    gh.calls.map((call) => `${call.method} ${new URL(call.url).pathname.replace("/repos/sayuyuyuyu/slytxt-lab", "")}`),
    [
      "GET /git/ref/heads/main",
      "POST /git/refs",
      "PUT /contents/src/content/comic/hello-world.md",
      "POST /pulls"
    ]
  );
  assert.equal(gh.calls[1].body.ref, "refs/heads/write/hello-world");
  assert.equal(gh.calls[1].body.sha, "base-sha");
  assert.equal(gh.calls[2].body.branch, "write/hello-world");
  assert.equal(Buffer.from(gh.calls[2].body.content, "base64").toString("utf8"), publishInput.content);
  assert.equal(gh.calls[3].body.head, "write/hello-world");
  assert.equal(gh.calls[3].body.base, "main");
  assert.equal(gh.calls[0].headers.authorization, "Bearer tok");

  assert.equal(result.prNumber, 9);
  assert.equal(result.prUrl, "https://github.com/x/y/pull/9");
  assert.equal(result.path, "src/content/comic/hello-world.md");
  assert.equal(result.url, "https://slytxt.dev/articles/comic/hello-world/");
});

test("obsidian: misc も write/ ブランチになる", async () => {
  const gh = fakeGitHub({
    "GET /git/ref/heads/main": { json: { object: { sha: "base-sha" } } },
    "POST /git/refs": { status: 201, json: {} },
    "PUT /contents/src/content/misc/memo.md": { status: 201, json: {} },
    "POST /pulls": { status: 201, json: { html_url: "u", number: 1 } }
  });
  await publishNote(gh.request, settings, {
    category: "misc",
    slug: "memo",
    title: "",
    content: "----\n"
  });
  assert.equal(gh.calls[1].body.ref, "refs/heads/write/memo");
});

test("obsidian: ベースブランチが無ければ理由つきで止まる", async () => {
  const gh = fakeGitHub({
    "GET /git/ref/heads/main": { status: 404, json: { message: "Not Found" } }
  });
  await assert.rejects(
    () => publishNote(gh.request, settings, publishInput),
    (error) => error instanceof PublishError && /ベースブランチ main が見つかりません/.test(error.message)
  );
  assert.equal(gh.calls.length, 1);
});

test("obsidian: 同じブランチが既にあれば PR を確認するよう促す", async () => {
  const gh = fakeGitHub({
    "GET /git/ref/heads/main": { json: { object: { sha: "base-sha" } } },
    "POST /git/refs": { status: 422, json: { message: "Reference already exists" } }
  });
  await assert.rejects(
    () => publishNote(gh.request, settings, publishInput),
    (error) => error instanceof PublishError && /既にあります/.test(error.message)
  );
  assert.equal(gh.calls.length, 2);
});

test("obsidian: ファイル書き込みや PR 作成の失敗は GitHub のメッセージを添える", async () => {
  const putFail = fakeGitHub({
    "GET /git/ref/heads/main": { json: { object: { sha: "base-sha" } } },
    "POST /git/refs": { status: 201, json: {} },
    "PUT /contents/src/content/comic/hello-world.md": {
      status: 403,
      json: { message: "Resource not accessible by personal access token" }
    }
  });
  await assert.rejects(
    () => publishNote(putFail.request, settings, publishInput),
    (error) =>
      error instanceof PublishError &&
      /ファイルを書けませんでした: Resource not accessible by personal access token/.test(error.message)
  );

  const prFail = fakeGitHub({
    "GET /git/ref/heads/main": { json: { object: { sha: "base-sha" } } },
    "POST /git/refs": { status: 201, json: {} },
    "PUT /contents/src/content/comic/hello-world.md": { status: 201, json: {} },
    "POST /pulls": { status: 422, json: { message: "Validation Failed" } }
  });
  await assert.rejects(
    () => publishNote(prFail.request, settings, publishInput),
    (error) => error instanceof PublishError && /PR を作れませんでした: Validation Failed/.test(error.message)
  );
});
