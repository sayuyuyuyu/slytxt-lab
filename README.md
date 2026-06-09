# しらゆラボ

Astro / TypeScript / MDX / Tailwind CSS / Pagefind で作る個人研究所サイトです。

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm preview
```

Pagefind の検索インデックスは `pnpm build` 時に `dist/pagefind` へ生成されます。検索の動作確認は `pnpm build` 後に `pnpm preview` で行ってください。

## Environment

本番 URL は `SITE_URL` で指定します。

```bash
SITE_URL=https://slytxt.dev
```

Cloudflare Pages では以下を指定します。

```text
Build command: pnpm build
Output directory: dist
```

## Content

公開する記事は以下に追加します。

```text
src/content/tech/
src/content/life/
src/content/projects/
```

ローカル動作確認用のサンプルは `*.sample.mdx` または `sample-*.mdx` にしてください。`.gitignore` で除外されます。

### Tech / Life

```yaml
title:
description:
published:
updated:
tags:
draft:
featured:
adult:
cover:
```

### Projects

```yaml
title:
description:
started:
updated:
status:
repo:
demo:
tags:
draft:
cover:
```

`status` は `planning` / `active` / `maintenance` / `paused` / `completed` のいずれかです。
