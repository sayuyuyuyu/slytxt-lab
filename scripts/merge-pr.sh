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

# GitHub の必須チェックは `ci` だけ。auto-merge を使えば GitHub 側が待って
# マージするので、こちらでポーリング（sleep ループ）しない。
# `Workers Builds: slytxt-feed` は常に失敗するが必須ではないため、
# auto-merge は required check の成功だけで進む。
gh pr merge "$number" --squash --delete-branch --auto
