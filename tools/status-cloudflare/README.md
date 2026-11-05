# 健康状態の受け口（Cloudflare 版）

About ページの「いまの状態」節に表示する、しらゆ本人の健康状態スナップショット（心拍・睡眠・歩数など）を保持・公開する Worker。cordx56 の isfine に倣ったもの。位置情報は含めない。

## 構成

- 単一 Worker（`src/index.mjs`）。入口はカスタムドメイン `status.slytxt.dev` のみ。
- スナップショットは Cloudflare KV（バインディング `STATUS_DATA`）のキー `latest` に1件だけ保持する。
- `GET /api/status` は保存済み JSON を公開返却する（`Access-Control-Allow-Origin: https://slytxt.dev`）。データが無ければ 404。
- `POST /api/status` は `Authorization: Bearer <STATUS_POST_TOKEN>` が一致したときだけ保存する。それ以外は 401。

## 更新の流れ

モカ側（Muse の VM）の `~/workspace/tools/slytxt-status-update.py` が Apple Health（health-cli）の集計からスナップショット JSON を組み立てて POST する。トークンは VM 側の `~/.config/slytxt-status/token`（パーミッション 600）にだけ置き、リポジトリには含めない。

スナップショットの形式:

```json
{
  "status": "元気です（たぶん）",
  "heart_rate_bpm": 72,
  "heart_rate_at": "2026-11-05T08:41:00+09:00",
  "sleep_hours": 6.5,
  "sleep_date": "2026-11-05",
  "steps_today": 1234,
  "resting_heart_rate_bpm": 58,
  "updated_at": "2026-11-05T09:00:00+09:00"
}
```

取れなかった項目は `null` で残す。

## デプロイ手順

前提: サイト本体と同じ Cloudflare アカウント。wrangler はリポジトリに依存を足さず `npx wrangler` で実行する。

```sh
cd tools/status-cloudflare
npx wrangler kv namespace create slytxt-status-data  # 初回のみ。ID を wrangler.toml へ反映
npx wrangler deploy
npx wrangler secret put STATUS_POST_TOKEN            # 初回のみ。値は標準入力で渡す
```

デプロイ後は `https://status.slytxt.dev/api/status` で GET の応答を確認する。
