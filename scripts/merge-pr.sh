#!/bin/sh
# PR を squash merge する。途中の手順（main の取り込み直し・必須チェック待ち）を
# まとめて行う。
#
# - main は strict な branch protection で、必須チェックは `ci` だけ。
#   main が進むと required check が "expected" のままになり merge が弾かれるので、
#   先に `gh pr update-branch` で取り込んで CI を回し直す。
# - `Workers Builds: slytxt-feed` は常に失敗するが必須ではないので、
#   `gh pr checks --watch`（失敗が1つでもあれば非0）は使わず `ci` だけを見る。
# - update-branch は新しい head を作るので、更新前の SUCCESS を掴まないよう
#   「更新より後に始まった ci」が成功するまで待つ。
set -eu

number="${1:-}"
if [ -z "$number" ]; then
  echo "usage: scripts/merge-pr.sh <pr-number>" >&2
  exit 2
fi

updated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
before="$(gh pr view "$number" --json headRefOid --jq .headRefOid)"
gh pr update-branch "$number" >/dev/null 2>&1 || true
after="$(gh pr view "$number" --json headRefOid --jq .headRefOid)"

i=0
while [ "$i" -lt 80 ]; do
  row="$(gh pr checks "$number" --json name,state,startedAt \
    --jq '[.[] | select(.name == "ci")] | sort_by(.startedAt) | last | "\(.state) \(.startedAt)"' 2>/dev/null || true)"
  state="${row%% *}"
  started="${row#* }"

  if [ "$state" = "SUCCESS" ]; then
    # 更新で head が変わったときだけ、更新後の実行であることを確かめる。
    if [ "$before" = "$after" ] || [ "${started:-}" \> "$updated_at" ] || [ "${started:-}" = "$updated_at" ]; then
      break
    fi
  fi

  case "$state" in
    FAILURE|CANCELLED|TIMED_OUT|SKIPPED)
      echo "ci が $state です。修正してから再実行してください。" >&2
      exit 1
      ;;
  esac
  i=$((i + 1))
  sleep 15
done

if [ "$i" -ge 80 ]; then
  echo "ci の完了を待ちきれませんでした（20分）。" >&2
  exit 1
fi

gh pr merge "$number" --squash --delete-branch
