#!/bin/sh
# PR を squash merge する。途中の手順（main の取り込み直し・必須チェック待ち）を
# まとめて行う。
#
# - main は strict な branch protection で、必須チェックは `ci` だけ。
#   main が進むと required check が "expected" のままになり merge が弾かれるので、
#   先に `gh pr update-branch` で取り込んで CI を回し直す。
# - `Workers Builds: slytxt-feed` は常に失敗するが必須ではないので、
#   `gh pr checks --watch`（失敗が1つでもあれば非0）は使わず `ci` だけを見る。
set -eu

number="${1:-}"
if [ -z "$number" ]; then
  echo "usage: scripts/merge-pr.sh <pr-number>" >&2
  exit 2
fi

gh pr update-branch "$number" >/dev/null 2>&1 || true

while :; do
  state="$(gh pr checks "$number" --json name,state --jq '.[] | select(.name == "ci") | .state' | head -1)"
  case "$state" in
    SUCCESS) break ;;
    FAILURE|CANCELLED|TIMED_OUT)
      echo "ci が $state です。修正してから再実行してください。" >&2
      exit 1
      ;;
    *) sleep 15 ;;
  esac
done

gh pr merge "$number" --squash --delete-branch
