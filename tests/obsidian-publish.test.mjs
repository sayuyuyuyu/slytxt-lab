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
  extractExtras,
  serializeFrontmatter
} from "../tools/obsidian-slytxt/src/lib/frontmatter.ts";
import {
  bodyImageSources,
  deriveDescription,
  firstImageSource,
  preparePublish,
  splitHeadingTitle
} from "../tools/obsidian-slytxt/src/lib/publish-plan.ts";
import { PublishError, publishNote, toBase64 } from "../tools/obsidian-slytxt/src/lib/github.ts";
import {
  MediaError,
  assertCoverSize,
  coverKey,
  uploadCover
} from "../tools/obsidian-slytxt/src/lib/media.ts";
import { classifyEmbedUrl, embedInsertion, embedLabel } from "../tools/obsidian-slytxt/src/lib/embed.ts";

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

test("obsidian: 再公開のときだけ updated が付き、ノート側の値も落とさない", () => {
  const first = preparePublish(
    { name: "note", category: "tech", title: "題名", body: "本文" },
    "2026-11-24"
  );
  assert.equal(first.frontmatter.published, "2026-11-24");
  assert.equal(first.frontmatter.updated, undefined);

  const again = preparePublish(
    { name: "note", category: "tech", title: "題名", body: "本文", published: "2026-11-01" },
    "2026-11-24"
  );
  assert.equal(again.frontmatter.published, "2026-11-01");
  assert.equal(again.frontmatter.updated, "2026-11-24");

  const sameDay = preparePublish(
    { name: "note", category: "tech", title: "題名", body: "本文", published: "2026-11-24" },
    "2026-11-24"
  );
  assert.equal(sameDay.frontmatter.updated, undefined);

  const kept = preparePublish(
    {
      name: "note",
      category: "tech",
      title: "題名",
      body: "本文",
      published: "2026-11-01",
      updated: "2026-11-20"
    },
    "2026-11-24"
  );
  assert.equal(kept.frontmatter.updated, "2026-11-24");

  const onlyGiven = preparePublish(
    { name: "note", category: "tech", title: "題名", body: "本文", updated: "2026-11-20" },
    "2026-11-24"
  );
  assert.equal(onlyGiven.frontmatter.updated, "2026-11-20");
});

test("obsidian: 管理外の frontmatter キーは公開ファイルへそのまま残る", () => {
  const raw = [
    "title: 題名",
    "adult: true",
    "memo: あとで読む",
    "tags: [a, b]",
    "aliases:",
    "  - one",
    "published: 2026-11-01",
    "category: tech"
  ].join("\n");
  const extras = extractExtras(raw);
  assert.deepEqual(extras, ["adult: true", "memo: あとで読む", "aliases:", "  - one"]);

  const payload = preparePublish(
    { name: "note", category: "tech", title: "題名", body: "本文", extras },
    "2026-11-24"
  );
  assert.match(payload.content, /^adult: true$/m);
  assert.match(payload.content, /^memo: あとで読む$/m);
  // 管理するキーはプラグインの値だけを1回書く。
  assert.equal(payload.content.match(/^title:/gm).length, 1);
  assert.equal(payload.content.match(/^published:/gm).length, 1);
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
  // 先頭が埋め込み URL 行・画像だけの行でも、それをタイトルにしない（#774）。
  assert.equal(
    deriveTitle("tech", "", "https://www.youtube.com/watch?v=abcdefghijk\n\n本文です。"),
    "本文です。"
  );
  assert.equal(
    deriveTitle("comic", "", "![](https://media.slytxt.dev/abc.jpg)\n\n漫画の説明。"),
    "漫画の説明。"
  );
  assert.equal(deriveTitle("tech", "", "https://www.youtube.com/watch?v=abcdefghijk"), "無題");
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

/* ---- 自動マージ ---- */

test("obsidian: PR に node_id があれば自動マージ（squash）を設定する", async () => {
  const gh = fakeGitHub({
    "GET /git/ref/heads/main": { json: { object: { sha: "base-sha" } } },
    "POST /git/refs": { status: 201, json: {} },
    "PUT /contents/src/content/comic/hello-world.md": { status: 201, json: {} },
    "POST /pulls": {
      status: 201,
      json: { html_url: "https://github.com/x/y/pull/9", number: 9, node_id: "PR_node_9" }
    }
  });
  // GraphQL は REST のパス接頭辞が付かないので、fake の外側で受ける。
  const baseRequest = gh.request;
  const calls = [];
  const request = async (options) => {
    calls.push(options.url);
    if (options.url === "https://api.github.com/graphql") {
      const body = JSON.parse(options.body);
      assert.match(body.query, /enablePullRequestAutoMerge/);
      assert.equal(body.variables.id, "PR_node_9");
      return { status: 200, json: { data: { enablePullRequestAutoMerge: { clientMutationId: null } } } };
    }
    return baseRequest(options);
  };
  const result = await publishNote(request, settings, publishInput);
  assert.equal(result.autoMerge, true);
  assert.equal(calls.at(-1), "https://api.github.com/graphql");
});

test("obsidian: 自動マージの設定に失敗しても PR の結果は返す", async () => {
  const gh = fakeGitHub({
    "GET /git/ref/heads/main": { json: { object: { sha: "base-sha" } } },
    "POST /git/refs": { status: 201, json: {} },
    "PUT /contents/src/content/comic/hello-world.md": { status: 201, json: {} },
    "POST /pulls": {
      status: 201,
      json: { html_url: "https://github.com/x/y/pull/9", number: 9, node_id: "PR_node_9" }
    }
  });
  const request = async (options) => {
    if (options.url === "https://api.github.com/graphql") {
      return { status: 200, json: { errors: [{ message: "Auto-merge is not allowed" }] } };
    }
    return gh.request(options);
  };
  const result = await publishNote(request, settings, publishInput);
  assert.equal(result.autoMerge, false);
  assert.equal(result.prNumber, 9);
});

/* ---- カバー画像のアップロード ---- */

const UUID = "123e4567-e89b-42d3-a456-426614174000";

test("obsidian: カバーのキーは MIME から拡張子を決める", () => {
  assert.equal(coverKey("image/jpeg", UUID), `${UUID}.jpg`);
  assert.equal(coverKey("image/png", UUID), `${UUID}.png`);
  assert.equal(coverKey("image/webp", UUID), `${UUID}.webp`);
  assert.throws(() => coverKey("image/heic", UUID), MediaError);
  assert.throws(() => coverKey("image/png", "not-a-uuid"), MediaError);
});

test("obsidian: カバーの大きさは 8MB までに縛る", () => {
  assert.doesNotThrow(() => assertCoverSize(1024));
  assert.throws(() => assertCoverSize(0), MediaError);
  assert.throws(() => assertCoverSize(8 * 1024 * 1024 + 1), MediaError);
});

test("obsidian: カバーは PUT で上げ、返ってきた公開 URL を使う", async () => {
  const seen = [];
  const request = async (options) => {
    seen.push(options);
    return { status: 201, json: { key: `${UUID}.png`, url: `https://media.slytxt.dev/${UUID}.png` } };
  };
  const url = await uploadCover(request, "token-123", new ArrayBuffer(16), "image/png", UUID);
  assert.equal(url, `https://media.slytxt.dev/${UUID}.png`);
  assert.equal(seen[0].method, "PUT");
  assert.equal(seen[0].url, `https://media.slytxt.dev/${UUID}.png`);
  assert.equal(seen[0].headers.authorization, "Bearer token-123");
  assert.equal(seen[0].headers["content-type"], "image/png");

  const denied = async () => ({ status: 401, json: { error: "トークンが違います。" } });
  await assert.rejects(
    () => uploadCover(denied, "wrong", new ArrayBuffer(16), "image/png", UUID),
    (error) => error instanceof MediaError && /トークン/.test(error.message)
  );
  await assert.rejects(
    () => uploadCover(request, "", new ArrayBuffer(16), "image/png", UUID),
    MediaError
  );
});

/* ---- 埋め込み URL ---- */

test("obsidian: 埋め込み URL の種別判定はサイト側と揃える", () => {
  assert.equal(classifyEmbedUrl("https://www.youtube.com/watch?v=abcdefghijk")?.type, "youtube");
  assert.equal(classifyEmbedUrl("https://youtu.be/abcdefghijk")?.type, "youtube");
  assert.equal(classifyEmbedUrl("https://www.youtube.com/shorts/abcdefghijk")?.type, "youtube");
  assert.equal(classifyEmbedUrl("https://open.spotify.com/intl-ja/track/1234567890abcd")?.type, "spotify");
  assert.equal(classifyEmbedUrl("https://x.com/sybtxt/status/1234567890")?.type, "x");
  assert.equal(classifyEmbedUrl("https://twitter.com/sybtxt/status/1234567890")?.type, "x");
  assert.equal(classifyEmbedUrl("https://example.com/article")?.type, "link");
  assert.equal(classifyEmbedUrl("ただの文章"), null);
  assert.equal(classifyEmbedUrl(""), null);
  assert.equal(embedLabel({ type: "youtube", url: "" }), "YouTube の埋め込み");
  assert.equal(embedInsertion("https://example.com"), "\n\nhttps://example.com\n\n");
});

/* ---- 見出しタイトル・自動カバー・説明文（2026-11-24 本人の指摘） ---- */

test("obsidian: 最初の見出しをタイトルに使い、本文からは除く", () => {
  const payload = preparePublish(
    {
      name: "ジャンプ感想",
      category: "comic",
      body: "# ジャンプ感想（2026年51・52号）\n\n先週書くの忘れたので2週分\n\n## あかね\n感想。"
    },
    "2026-11-24"
  );
  assert.equal(payload.title, "ジャンプ感想（2026年51・52号）");
  assert.ok(!payload.content.includes("# ジャンプ感想"), "見出しが本文に残っている");
  assert.ok(payload.content.includes("## あかね"));
  assert.ok(payload.frontmatter.description.startsWith("先週書くの忘れたので2週分"));
});

test("obsidian: タイトル指定が見出しと一致したら見出しを本文から除く", () => {
  const payload = preparePublish(
    {
      name: "メモ",
      category: "tech",
      title: "題名",
      body: "# 題名\n\n本文です。"
    },
    "2026-11-24"
  );
  assert.equal(payload.title, "題名");
  assert.ok(!payload.content.includes("# 題名"));
});

test("obsidian: misc は見出しをタイトルにせず本文にも残す", () => {
  const payload = preparePublish(
    { name: "メモ", category: "misc", body: "# 見出しメモ\n\n本文です。" },
    "2026-11-24"
  );
  assert.equal(payload.title, "");
  assert.ok(payload.content.includes("# 見出しメモ"));
});

test("obsidian: splitHeadingTitle は H1 のときだけ切り出す", () => {
  assert.deepEqual(splitHeadingTitle("# 題\n\n本文"), { heading: "題", body: "本文" });
  assert.equal(splitHeadingTitle("## 小見出し\n本文"), null);
  assert.equal(splitHeadingTitle("書き出し\n# 後ろの見出し"), null);
  assert.equal(splitHeadingTitle(""), null);
});

test("obsidian: firstImageSource は最初の画像を記法の順で返す", () => {
  assert.equal(
    firstImageSource("文\n\n![](https://media.slytxt.dev/a.jpg)\n"),
    "https://media.slytxt.dev/a.jpg"
  );
  assert.equal(firstImageSource("![[Pasted image 2026.png]]\n\n文"), "Pasted image 2026.png");
  assert.equal(
    firstImageSource("![[first.png]]\n![](https://example.com/second.jpg)"),
    "first.png"
  );
  assert.equal(firstImageSource("画像なし"), null);
});

test("obsidian: bodyImageSources は本文の画像を出現順に重複なく返す（#917）", () => {
  assert.deepEqual(
    bodyImageSources(
      "文\n\n![[Pasted image 2026.png]]\n\n![](https://media.slytxt.dev/a.jpg)\n\n![[Pasted image 2026.png]]\n"
    ),
    ["Pasted image 2026.png", "https://media.slytxt.dev/a.jpg"]
  );
  assert.deepEqual(bodyImageSources("![図](photo.jpg)"), ["photo.jpg"]);
  assert.deepEqual(bodyImageSources("画像なし"), []);
});

test("obsidian: 説明文は画像埋め込み行を飛ばし、記法も残さない（#797）", () => {
  assert.equal(
    deriveDescription("![[Pasted image 2026.png]]\n\n本文の書き出しです。"),
    "本文の書き出しです。"
  );
  assert.equal(
    deriveDescription("![](https://media.slytxt.dev/a.jpg)\n本文です。"),
    "本文です。"
  );
  const mixed = deriveDescription("前文 ![](https://media.slytxt.dev/a.jpg) 後文です。");
  assert.ok(!mixed.includes("media.slytxt.dev"), "画像 URL が説明文に混ざっている");
  assert.ok(mixed.includes("前文"));
});

test("obsidian: 公開後の X 投稿はタイトルと記事 URL を入れた intent を開く", async () => {
  const { shareTarget, xIntentUrl } = await import("../tools/obsidian-slytxt/src/lib/share.ts");
  assert.equal(
    xIntentUrl("新しい記事", "https://slytxt.dev/articles/tech/new-post/"),
    `https://twitter.com/intent/tweet?text=${encodeURIComponent("新しい記事")}&url=${encodeURIComponent("https://slytxt.dev/articles/tech/new-post/")}`
  );
  // misc（Journal）はタイトルを持たないので、投稿文にも入れない。
  assert.equal(
    shareTarget("misc", "memo", "").xUrl,
    `https://twitter.com/intent/tweet?text=&url=${encodeURIComponent("https://slytxt.dev/articles/misc/memo/")}`
  );
  assert.deepEqual(shareTarget("comic", "2026-11-25-strip", "4コマ"), {
    articleUrl: "https://slytxt.dev/articles/comic/2026-11-25-strip/",
    xUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent("4コマ")}&url=${encodeURIComponent("https://slytxt.dev/articles/comic/2026-11-25-strip/")}`
  });
});
