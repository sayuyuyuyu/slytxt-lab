import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyEmbedUrl,
  embedHtmlForUrl,
  linkCardHtml,
  spotifyEmbedHtml,
  xEmbedHtml,
  youtubeEmbedHtml
} from "../src/lib/remark-embed.mjs";

test("embeds: YouTube の URL 形式を判定する", () => {
  assert.equal(
    classifyEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.type,
    "youtube"
  );
  assert.equal(
    classifyEmbedUrl("https://www.youtube.com/watch?t=42&v=dQw4w9WgXcQ")?.id,
    "dQw4w9WgXcQ"
  );
  assert.equal(classifyEmbedUrl("https://youtu.be/dQw4w9WgXcQ")?.id, "dQw4w9WgXcQ");
  assert.equal(
    classifyEmbedUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")?.id,
    "dQw4w9WgXcQ"
  );
  assert.equal(classifyEmbedUrl("https://www.youtube.com/feed/subscriptions")?.type, "link");
});

test("embeds: X のポスト URL を判定する", () => {
  const fromX = classifyEmbedUrl("https://x.com/slytxt/status/1234567890123456789");
  assert.equal(fromX?.type, "x");
  assert.equal(fromX?.user, "slytxt");
  assert.equal(fromX?.id, "1234567890123456789");
  assert.equal(
    classifyEmbedUrl("https://twitter.com/slytxt/status/1234567890123456789/photo/1")?.type,
    "x"
  );
  assert.equal(classifyEmbedUrl("https://x.com/slytxt")?.type, "link");
});

test("embeds: URL でないものは対象外", () => {
  assert.equal(classifyEmbedUrl("ただの文章 https://example.com"), null);
  assert.equal(classifyEmbedUrl("ftp://example.com/file"), null);
  assert.equal(classifyEmbedUrl(""), null);
  assert.equal(classifyEmbedUrl("https://example.com/page")?.type, "link");
});

test("embeds: 生成 HTML に必要な要素が入る", () => {
  assert.match(youtubeEmbedHtml("dQw4w9WgXcQ"), /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  assert.match(xEmbedHtml({ url: "https://x.com/a/status/1" }), /twitter-tweet/);
  assert.doesNotMatch(xEmbedHtml({ url: "https://x.com/a/status/1" }), /widgets\.js/);
  const card = linkCardHtml({
    url: "https://example.com/a?x=1&y=2",
    ogp: { title: "タイトル <b>", description: "説明", image: "https://example.com/i.png" }
  });
  assert.match(card, /タイトル &lt;b&gt;/);
  assert.match(card, /a\?x=1&amp;y=2/);
  const bare = linkCardHtml({ url: "https://example.com/a", ogp: null });
  assert.match(bare, /link-card__host">example\.com</);
  assert.doesNotMatch(bare, /link-card__image/);
});

test("embeds: URL から種別ごとの HTML を作る", async () => {
  const youtube = await embedHtmlForUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.match(youtube, /embed--youtube/);
  const x = await embedHtmlForUrl("https://x.com/slytxt/status/1234567890123456789");
  assert.match(x, /embed--x/);
  const card = await embedHtmlForUrl("https://example.com/article", async () => ({
    title: "記事タイトル",
    description: "",
    image: ""
  }));
  assert.match(card, /記事タイトル/);
  const bare = await embedHtmlForUrl("https://example.com/none", async () => null);
  assert.match(bare, /link-card/);
  assert.equal(await embedHtmlForUrl("URL ではない"), null);
});

test("embeds: Spotify の URL 形式を判定する", () => {
  const track = classifyEmbedUrl("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC");
  assert.equal(track?.type, "spotify");
  assert.equal(track?.kind, "track");
  assert.equal(track?.id, "4uLU6hMCjMI75M1A2tKUQC");
  assert.equal(
    classifyEmbedUrl("https://open.spotify.com/intl-ja/track/4uLU6hMCjMI75M1A2tKUQC?si=abc123")?.type,
    "spotify"
  );
  assert.equal(
    classifyEmbedUrl("https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3")?.kind,
    "album"
  );
  assert.equal(
    classifyEmbedUrl("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")?.kind,
    "playlist"
  );
  assert.equal(
    classifyEmbedUrl("https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ")?.kind,
    "episode"
  );
  assert.equal(
    classifyEmbedUrl("https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk")?.kind,
    "show"
  );
  assert.equal(
    classifyEmbedUrl("https://open.spotify.com/artist/0TnOyISbd1XYRBk9myaseg")?.kind,
    "artist"
  );
  assert.equal(classifyEmbedUrl("https://open.spotify.com/genre/pop")?.type, "link");
  assert.equal(
    classifyEmbedUrl("https://spotify.com/track/4uLU6hMCjMI75M1A2tKUQC")?.type,
    "link"
  );
});

test("embeds: Spotify の埋め込み HTML を作る", async () => {
  assert.match(
    spotifyEmbedHtml({ kind: "track", id: "4uLU6hMCjMI75M1A2tKUQC" }),
    /open\.spotify\.com\/embed\/track\/4uLU6hMCjMI75M1A2tKUQC/
  );
  assert.match(spotifyEmbedHtml({ kind: "track", id: "4uLU6hMCjMI75M1A2tKUQC" }), /height="152"/);
  assert.match(spotifyEmbedHtml({ kind: "album", id: "1DFixLWuPkv3KT3TnV35m3" }), /height="352"/);
  const html = await embedHtmlForUrl("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC");
  assert.match(html, /embed--spotify/);
});
