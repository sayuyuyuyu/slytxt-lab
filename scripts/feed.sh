#!/usr/bin/env bash
# 短文フィードの運用コマンド。長いオプションを打たなくて済むようにまとめたもの。
#
#   ./scripts/feed.sh db                 テーブルを本番 D1 に適用（db/feed/0001_init.sql）
#   ./scripts/feed.sh sql "SELECT ..."   本番 D1 で SQL を実行
#   ./scripts/feed.sh tables             テーブル一覧を出す
#   ./scripts/feed.sh deploy             投稿 Worker（feed.slytxt.dev）をデプロイ
#   ./scripts/feed.sh local-db           ローカル D1 にテーブルを作る
#
# どのコマンドもリポジトリのルートから実行する想定。
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config="$root/tools/feed-cloudflare/wrangler.toml"
wrangler() { npx -y wrangler@latest "$@"; }

case "${1:-}" in
  db)
    wrangler d1 execute slytxt-feed -c "$config" --remote --file "$root/db/feed/0001_init.sql"
    ;;
  sql)
    [ $# -ge 2 ] || { echo '使い方: ./scripts/feed.sh sql "SELECT ..."' >&2; exit 2; }
    wrangler d1 execute slytxt-feed -c "$config" --remote --command "$2"
    ;;
  tables)
    wrangler d1 execute slytxt-feed -c "$config" --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
    ;;
  deploy)
    wrangler deploy -c "$config"
    ;;
  local-db)
    wrangler d1 execute slytxt-feed -c "$config" --local --file "$root/db/feed/0001_init.sql"
    ;;
  *)
    sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
