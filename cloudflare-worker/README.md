# HenrikDev API プロキシ + キャッシュ (Cloudflare Workers)

`config.js` に平文で書かれている HenrikDev API キーをブラウザから隠すためのプロキシです。
あわせて Workers KV でレスポンスをキャッシュし、HenrikDev への実際のリクエスト数を
減らします(レート制限対策)。GitHub Pages 側のサイト URL
(`https://hiromps.github.io/...`) は変更しません。変わるのは JS が API を呼び出す先だけです。

```
ブラウザ → この Worker (api_key はここでだけ付与、KVキャッシュも参照) → api.henrikdev.xyz
```

## デプロイ手順

このフォルダ (`cloudflare-worker/`) で作業します。

```bash
npm install -g wrangler   # 未インストールの場合
wrangler login             # Cloudflare アカウントで認証(ブラウザが開きます)

cd cloudflare-worker

# 1. キャッシュ用 KV namespace を作成
wrangler kv namespace create VALORANT_CACHE
# 出力される id を wrangler.toml の [[kv_namespaces]] の id に貼り付ける

# 2. HenrikDev の実APIキーを secret として登録(ファイルには書かない)
wrangler secret put HENRIKDEV_API_KEY

# 3. デプロイ
wrangler deploy
```

デプロイが成功すると `https://hiromps-valorant-proxy.<あなたのサブドメイン>.workers.dev`
のような URL が発行されます。この URL を控えてください。

## 動作確認

```bash
curl -i "https://hiromps-valorant-proxy.<サブドメイン>.workers.dev/valorant/v1/mmr/ap/テストユーザー名/タグ"
```

HenrikDev から通常のレスポンス(またはプレイヤーが見つからない旨のエラー)が返ってくれば
成功です。レスポンスに `api_key` は含まれません。

レスポンスヘッダーの `X-Cache` が `MISS`(初回・HenrikDevへ実際に問い合わせた)か
`HIT`(KVキャッシュから返した)かを示します。同じURLをキャッシュ期間内にもう一度叩くと
`HIT` になり、HenrikDev側へはリクエストが飛びません。

## キャッシュ期間(TTL)

`worker.js` の `getCacheTtlSeconds()` でパスごとに設定しています。

| データ | TTL | 理由 |
|---|---|---|
| マッチ詳細 (`v4/match/...`) | 30日 | 過去の試合結果は変化しない |
| アカウント情報 (`v2/account/...`) | 1時間 | 名前→PUUIDの対応はほぼ変化しない |
| リーダーボード (`v2/leaderboard/...`) | 5分 | 頻繁な更新は不要 |
| 現在のランク/MMR・マッチ一覧・MMR履歴 | 60秒 | Cloudflare KVの`expirationTtl`下限が60秒のため |

特定のキャッシュだけ即時に消したい場合:

```bash
wrangler kv key list --binding=VALORANT_CACHE
wrangler kv key delete "<表示されたキー>" --binding=VALORANT_CACHE
```

## 許可オリジン

`worker.js` 内の `ALLOWED_ORIGINS` で、ブラウザからの呼び出しを許可するオリジンを
`https://hiromps.github.io` とローカル開発用の `http://localhost:3000` に制限しています。
別のオリジンからサイトを配信する場合はここに追加してください。

## 次のステップ

Worker の URL が確認できたら、リポジトリ側の `config.js` /
`valorant-stats-tracker/js/api.js` の呼び出し先をこの Worker の URL に切り替え、
ハードコードされた API キーを削除します(この変更は別途実施してください)。

## 注意: 既存キーの扱い

`config.js` に書かれていた API キーは Git の公開履歴に残っているため、コードから削除しても
無効化されるわけではありません。HenrikDev のダッシュボードで **新しいキーを再発行し、
古いキーは失効させる** ことを推奨します。新しいキーだけを上記の `wrangler secret put` で
Worker に登録してください。
