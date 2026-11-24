#!/bin/sh
# リポジトリの検証を1コマンドで通す。`pnpm run verify` と同じ内容。
# pnpm が無い環境（エージェントのサンドボックスなど）でも同じ検証を回せるよう、
# node_modules の実行ファイルへ直接フォールバックする。
set -eu
cd "$(dirname "$0")/.."

if command -v pnpm >/dev/null 2>&1; then
  exec pnpm run verify
fi

echo "pnpm が無いため、node_modules の実行ファイルで検証します" >&2
node_modules/.bin/astro check
node --experimental-strip-types --test tests/*.test.mjs
node_modules/.bin/astro build --force
node_modules/.bin/pagefind --site dist --glob "**/*.html"
node scripts/check-build.mjs
