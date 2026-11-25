# ターミナル形式デザインのアーカイブ（2026-11）

2026-11-25 まで本番に残っていたターミナル風の見た目を、あとから戻せるように記録する。
方針は #884、配色は #855（紺 × ティール × クリーム）が基準。

## アーカイブの場所

- タグ: `archive/terminal-design-2026-11`（`main` の 2026-11-25 時点）
- 復元するときは、そのタグからファイル単位で戻す。

  ```sh
  git checkout archive/terminal-design-2026-11 -- src/pages/404.astro src/styles/global.css
  ```

## 何を残したか

| 場所 | 中身 |
| --- | --- |
| `src/pages/404.astro` | ターミナル窓のモック（赤・黄・緑のドット、`slytxt.dev — zsh`、`$ open <path>` のログ） |
| `src/styles/global.css` | `.not-found__terminal` / `.terminal__bar` / `.terminal__dot*` / `.terminal__title` / `.not-found__log`、`.prompt`、`@keyframes cursor-blink`、`.brand__cursor`（点滅するカーソル）、`.brand__mark`（`❯`）、`.site-menu a::before` の `$ `、`.eyebrow::before` の `❯ `、`.toc__title::before` / `.footer-links a::before` / `.empty-state__cmd::before` の `$ ` |
| `src/components/EmptyState.astro` | `ls` の一行（`empty-state__cmd`） |
| `src/lib/bookmarks/render.ts` | 一覧と埋め込みの `❯` / `$` の装飾 |
| `src/lib/og.ts` | OG カードのターミナル窓のモック（窓枠・3つのドット・`$ ~/<category>`・`█`） |

## いまの状態

- 404 はターミナル窓ではなく、見出しと本文、戻り導線だけにした。
- `❯` / `$ ` の装飾とカーソル点滅は本番の CSS から外した（`.prompt` と `cursor-blink` も削除）。
- OG カードのターミナル窓は #884 の対象外として残している。替えるときはこのアーカイブを参照する。
