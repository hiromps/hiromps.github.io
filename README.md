# VALORANT Tracker Overlay

VALORANTのプレイヤー情報を表示するOBS配信用オーバーレイと、詳細な戦績を確認できる戦績トラッカーの2アプリからなる静的サイトです。ビルドなし・ES Modules直配信で、GitHub Pagesでそのまま公開しています。

- **公開URL**: https://hiromps.github.io/
- **戦績トラッカー**: https://hiromps.github.io/valorant-stats-tracker/

## 機能

### OBSオーバーレイ（ルート `/`）
- プレイヤー名とタグから現在のランク・RR・直近マッチのRR変動を取得して表示
- OBSのブラウザソースに直接読み込める透過背景モード
- 4種類のデザインテーマ（クラシック / モダン / Cyber / Neon）
- 背景色・文字色・境界線色などをカラーピッカーでカスタマイズし、設定を保存したURLを生成
- 30秒間隔（デフォルト）での自動更新

### 戦績トラッカー（`/valorant-stats-tracker/`）
- 直近のコンペティティブマッチ履歴、ランク推移、ACS/K-D/HS%などの統計をグラフ表示
- 独自のTracker Score算出とランキング表示

### その他のページ
- `/leaderboard.html` — 地域別リーダーボード
- `/match-history.html` — プレイヤー検索によるマッチ履歴表示
- `/skins-database.html` — スキンデータベース（フィルタ・レアリティ・価格表示）

## OBSでの使い方

1. ルートページでプレイヤー名とタグを入力すると、右側にリアルタイムプレビューが表示されます
2. 「URLを生成」ボタンを押すと、現在の色設定を含んだURLが生成されます
3. 生成されたURLをコピーします
4. OBS Studio →「ソース」の「+」→「ブラウザ」→「新規作成」でURLを貼り付けます
   - 幅・高さ: 900×400（高画質）または 450×200（標準）を推奨
   - 追加後、プレビュー画面で右クリック→「変換」→「画面に合わせる」で調整できます
5. プレビュー画面上でオーバーレイの位置を自由にドラッグして配置してください

オーバーレイは30秒間隔で自動更新されます。ランク情報が正しく表示されない場合はURLを生成し直してください。APIの制限により一時的にデータが取得できないことがあります。

## URLパラメータ一覧

| パラメータ | 説明 |
|---|---|
| `name` | プレイヤー名 |
| `tag` | タグライン（`#`は不要） |
| `obs` | 付与するとOBSモード（透過背景・中央配置・自動更新有効）になる。値は不要 |
| `updateInterval` | 自動更新間隔（秒）。URL生成時は`30`固定 |
| `theme` | デザインテーマ。`classic` / `modern` / `shadcn`（Cyber） / `neon` |
| `rankBgColor` / `rankBgOpacity` | ランク背景色（hex）と不透明度（0-100） |
| `lastMatchBgColor` / `lastMatchBgOpacity` | 前回マッチ欄の背景色と不透明度 |
| `textColor` | 文字色 |
| `rrColor` | RRテキストの色 |
| `borderColor` / `borderOpacity` | 境界線の色と不透明度 |

色設定は `rankBgColor` / `rankBgOpacity` / `textColor` の3つが揃っている場合のみURLの値が適用されます（揃っていない場合はブラウザに保存済みの設定にフォールバックします）。

## API・データについて

- ランク・マッチ情報の取得には非公式の [HenrikDev API](https://docs.henrikdev.xyz/) を使用しています
- APIキーはクライアントに一切渡さず、Cloudflare Worker製のプロキシ（`cloudflare-worker/`）側のsecretとしてのみ保持しています。`config.js` の `API_BASE_URL` はこのWorkerのURLを指しており、ブラウザは直接 `api.henrikdev.xyz` を呼び出しません
- Workerはレスポンスを Workers KV にキャッシュし、HenrikDev への実際のリクエスト数を抑えています（詳細は `cloudflare-worker/README.md`）

## リポジトリ構成

```
/
├── index.html              OBSオーバーレイ本体
├── config.js                API呼び出し先設定(Cloudflare WorkerプロキシのURL。APIキーは含まない)
├── styles.css / pages.css / accessibility.css
├── js/
│   ├── api.js               HenrikDev API呼び出し層（classic script、複数ページで共有）
│   ├── performance.js       遅延読み込み等のパフォーマンス最適化
│   └── overlay/              オーバーレイのESモジュール群
│       ├── state.js / layout.js / theme.js / render.js
│       ├── auto-update.js / settings.js / preview.js / main.js
├── shared/
│   └── ranks.js              ランク名→画像ファイル名の共有マッピング（ESモジュール）
├── assets/images/
│   ├── ranks/                 ランクアイコン（iron1〜radiant, unranked）
│   └── agents/                 エージェントアイコン
├── valorant-stats-tracker/
│   ├── index.html
│   └── js/                     main.js / api.js / process.js / render.js / chart.js
├── leaderboard.html / match-history.html / skins-database.html
├── riot.txt                    Riot Developer Portal 所有権確認用
└── cloudflare-worker/          HenrikDev APIプロキシ + KVキャッシュ(Cloudflare Workers、別デプロイ)
    ├── worker.js
    ├── wrangler.toml
    └── README.md                デプロイ手順
```

## ローカル開発

ES Modules（`<script type="module">`）を使用しているため `file://` での直接オープンは動作しません。リポジトリルートからHTTPサーバーで配信してください。

```bash
python -m http.server 3000
```

その後 `http://localhost:3000/` にアクセスします。

## 技術スタック

- HTML5 / CSS3 / JavaScript（ES Modules、ビルドなし）
- [HenrikDev API](https://docs.henrikdev.xyz/)（非公式VALORANT API）
- [Chart.js](https://www.chartjs.org/)（戦績トラッカーのグラフ表示）

## ライセンス

MIT License
