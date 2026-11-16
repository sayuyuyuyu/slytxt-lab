# Obsidian プラグイン（slytxt publish）

Obsidian から slytxt-lab へ記事を公開するプラグインです。書く場所を Obsidian（iOS アプリ）に寄せ、writer（`write.slytxt.dev`）を引退させるための移行先になります（#707）。

## できること（今回の範囲）

- コマンド **「公開の項目（タイトル・タグ・説明・カバー）を入力」** … カテゴリ・タイトル・タグ・説明文・カバー URL をモーダルで入力し、ノートの frontmatter に反映する。YAML を手で書かなくて済む。
- コマンド **「PR を作る（公開）」** … ノートの frontmatter と本文から、GitHub API でブランチと PR を作る。PR の番号と URL を通知する。
- 公開状態の確認は PR を見る（writer の画面は無い）。

次の段階（未実装）: 説明文の AI 候補、カバー画像のアップロード（R2）、埋め込み URL の入力支援。

## 仕組み

- 記事のパス・ブランチ名・公開 URL は writer と同じ規則です（`src/lib/slug.ts`）。notes だけ `note/` ブランチ、ほかは `write/`。
- frontmatter はサイトのスキーマに合わせてキー順を固定し、必要な値だけ引用します（`src/lib/frontmatter.ts`）。
- GitHub との通信は `src/lib/github.ts` に閉じ込め、HTTP を差し替え可能にしてあります（Obsidian では `requestUrl` を渡す）。手順（ブランチ→ファイル→PR）と失敗時のメッセージはテストで確認しています。

## インストール（自分の Vault へ）

1. 依存を入れてビルドする（このディレクトリで）。

   ```sh
   pnpm install
   node esbuild.config.mjs
   ```

2. Vault の `.obsidian/plugins/slytxt-publish/` を作り、`main.js`・`manifest.json`・`styles.css` をコピーする。
3. Obsidian の設定 → コミュニティプラグイン → インストール済みを再読み込みし、`slytxt publish` を有効にする。
4. 設定 → slytxt publish で、オーナー（`sayuyuyuyu`）・リポジトリ（`slytxt-lab`）・ベースブランチ（`main`）・既定カテゴリ・GitHub トークンを入れる。

### GitHub トークン

fine-grained PAT を作り、対象リポジトリを `slytxt-lab` だけに絞って、次の権限を付けます。

- Contents: Read and write（ブランチ作成・ファイル書き込み）
- Pull requests: Read and write（PR 作成）

トークンはプラグインの `data.json`（Vault 内の `.obsidian/plugins/slytxt-publish/`）にだけ保存されます。Vault を共有・同期している場合はその範囲で一緒に移動するので、扱いに注意してください。

## 使い方

1. ノートに本文を書く（frontmatter は無くてよい）。
2. コマンドパレットから **公開の項目を入力** を実行し、カテゴリ・タイトル・タグ・説明文・カバー URL を入れる。
3. **PR を作る（公開）** を実行する。成功すると `PR #12 を作成しました: https://github.com/...` と通知が出る。
4. GitHub で PR の CI が通ればマージする（writer と同じく、公開は PR 経由）。

## 開発

```sh
pnpm install
node esbuild.config.mjs --watch   # main.js を監視ビルド
pnpm typecheck                    # このディレクトリの tsc
```

純粋なロジック（slug・frontmatter・公開一式・GitHub 手順）はリポジトリ直下のテストで検証しています。

```sh
cd ../..
node --experimental-strip-types --test tests/obsidian-publish.test.mjs
```

## 注意

- iPhone 実機での通し確認（下書き作成 → frontmatter 入力 → PR 作成 → マージ → 記事ページ反映）はまだ行っていません。
- カバー画像のアップロードは未実装なので、いまは `media.slytxt.dev` の URL を直接入れてください。
