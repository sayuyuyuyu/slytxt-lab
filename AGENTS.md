# 作業方針

- 原則として日本語で、簡潔に報告する。
- 編集前に既存の変更を確認し、関係のない変更は保持する。
- `main` へ直接 push せず、作業ブランチと Pull Request を使う。
- 外部サービスへの公開、依存関係の追加、設定の大きな変更は事前に確認する。

# UI と文章

- このサイトは個人のメモと制作物を置く場所として扱う。プロダクトのLPのような大仰な演出や、過剰な装飾を加えない。
- 情報の優先順位、本文の読みやすさ、余白を優先する。
- UI は見た目で示す。文字は、本人が書いたコンテンツ・見出し・カテゴリ・サイト名・操作に必要な最小限だけ。説明文、プレースホルダ、空状態の文、「閉じる」のような補助ラベル、点滅する飾りを置かない。アイコンは文字の字形ではなく、線と大きさを揃えた SVG を使う。
- この規範は `node scripts/check-ui-text.mjs` が機械的に見張る。UI に文字を足すときは `ui-text-allowlist.json` に理由付きで追加する（追加はレビューで必ず目に入る）。破ったら CI が落ちる。
- 日本語は具体的で短く書く。「個人研究所」「知識ベース」など、内容を説明しない抽象語を安易に使わない。
- 見出しと導入文は、読むと何があるページか分かる表現にする。
- 技術的な文章を追加・推敲するときは、段落ごとに話題を一つに絞り、LLM的な予告・総括・空虚な強調を避ける。

# 執筆

- 執筆は Obsidian プラグイン（`tools/obsidian-slytxt/`）で行う。下書きは Vault のノートで、KV 同期はしない。ノートから「PR を作る」でブランチと Pull Request を作り、自動マージ（squash）を設定する。
- `drafts/` は移行前の下書きの原本で、コミットしない。公開するのは `src/content/<category>/<slug>.md` だけ。
- 公開は Pull Request 経由で行う。手で出す場合も `main` へ直接 push しない。
- 文体の規範は `~/.agents/skills/slytxt-writing/SKILL.md`。サイトの文章を直すときもこれに合わせる。
- `tools/obsidian-slytxt/` はサブプロジェクトとして `package.json` を持つ。依存はそちらで管理し、サイト本体には足さない。

# 検証

- UI またはコンテンツを変更したら、可能な範囲で `pnpm check` と `pnpm run verify` を実行する。pnpm が無い環境では `./scripts/verify.sh`（同じ検証を node_modules の実行ファイルで回す）。
- Cloudflare Pages の Pull Request プレビューが利用できる場合は、主要ページの表示も確認する。

# Issue ループ

- キューは `muse-overnight` ラベルの Issue。1 Issue = 1 PR。
- 検証は `pnpm verify`（pnpm が無ければ `./scripts/verify.sh`）。UI を変えたら `pnpm test:e2e` も実行する。CI でも `e2e` ジョブが同じものを回す。
- `ci` が通ったら `./scripts/merge-pr.sh <PR番号>` で squash merge する（main の取り込み直しと ci 待ちを含む）。`Workers Builds: slytxt-feed` は常に赤だが必須ではない。手順の詳細は `~/.agents/skills/issue-loop/SKILL.md` に従う。
- 記事本文を書くときは `~/.agents/skills/slytxt-writing/SKILL.md` に従う。
