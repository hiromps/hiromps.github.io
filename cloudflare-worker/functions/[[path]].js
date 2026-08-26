// VALORANT API プロキシ + 多層キャッシュ (Cloudflare Pages Functions)
//
// 目的:
// 1) ブラウザから API を直接叩くとキーがソース/通信内容にそのまま露出して
//    しまうため、実キーはこの Function の secret にのみ保持する。
//    - env.HENRIKDEV_API_KEY: HenrikDev API 用 (/valorant/* 経路)
//    - env.RIOT_API_KEY:      Riot 公式 API 用 (/riot/* 経路)
// 2) 同じ問い合わせをキャッシュし、アップストリームへの実際のリクエスト数を
//    減らす(レート制限に引っかかりにくくする)。
//
// 経路は2系統:
// - /valorant/* : HenrikDev への素通しプロキシ。Riot 公式キーのスコープでは賄えない
//   マッチ履歴などはこちら。
// - /riot/* : Riot 公式APIを叩き、レスポンスを HenrikDev 互換の形に変換して返す
//   独自エンドポイント群。Riot 側が失敗/非対応の場合は HenrikDev に自動フォールバックする。
//     /riot/leaderboard/{region}                 → Henrik v3 leaderboard 互換
//     /riot/mmr/v1/{region}/{name}/{tag}          → Henrik v1/mmr 互換
//     /riot/mmr/v2/{region}/{name}/{tag}          → Henrik v2/mmr 互換
//     /riot/mmr-history/{region}/{name}/{tag}     → Henrik v1/by-puuid/mmr-history 互換
//
// MMR系(RR)は公式APIに per-player エンドポイントが存在しない。取れるのは
// val-ranked-v1 リーダーボード掲載者(各リージョン上位15000人 ≒ Immortal1以上)の分だけ。
// そのため「Immortal1以上は Riot 公式リーダーボードから探索、それ未満は HenrikDev へ
// 自動フォールバック」というハイブリッド方式を取る(詳細は README・
// claudedocs/riot-api-henrik-replacement-findings.md 参照)。
// RR変動(mmr_change_to_last_game)・試合ごとのRR履歴は公式に存在しないため、D1
// (env.VALORANT_RR)に自前で観測値を記録して差分を算出する。KVではなくD1を使うのは、
// KVが1日1,000書き込み/アカウント全体という上限(2026-08-25に超過アラート済み)を
// 持つのに対し、D1は無料枠でも書き込み10万行/日と別枠かつ2桁大きいため。
//
// キャッシュは3層構成:
//   ① ブラウザ (Cache-Control: max-age)
//      OBSオーバーレイの定期ポーリングをクライアント側で吸収する。配布済みの
//      オーバーレイURLは updateInterval が焼き込まれていて後から変更できないため、
//      ここで吸収できることが最も効く。
//   ② Cloudflare エッジ (Cache API / caches.default)
//      無料・操作回数の上限なし。ここが実質の主キャッシュ。
//      ※ Workers を *.workers.dev で動かすと Cache API は no-op になるが、
//        Pages Functions は *.pages.dev でも機能するため、この構成を採っている。
//   ③ Workers KV
//      書き込みが 1日1,000回(Cloudflareアカウント全体で共有)に制限されるため、
//      「エッジをまたいで共有する価値が高く、書き込み回数が積み上がらないもの」
//      だけに限定する = マッチ詳細(不変)と Riot の現行アクトID。
//      以前は全レスポンスを KV に入れており、OBSの定期ポーリングだけで
//      1日の書き込み上限を使い切っていた。

const ALLOWED_ORIGINS = new Set([
  'https://hiromps.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

const UPSTREAM_HOST = 'https://api.henrikdev.xyz';

// ---- Riot 公式 API (/riot/* 経路) ----
// リージョンはホスト名 `https://{region}.api.riotgames.com` に埋め込まれるため、
// ホワイトリスト外の値を通すと任意ホストへのリクエストになりうる。必ず検証する。
const RIOT_REGIONS = new Set(['ap', 'eu', 'na', 'kr', 'br', 'latam']);
// 現行アクトIDのキャッシュ。アクトは数週間単位でしか切り替わらないので長めでよい。
// 切替直後は leaderboard が 400/404 を返すため、その時にキャッシュを破棄して再解決する。
// KV に置く数少ないデータのひとつ(6時間TTL = 1日あたり数回の書き込みにしかならず、
// colo をまたいで共有できる価値の方が大きい)。
const RIOT_ACT_TTL_SECONDS = 60 * 60 * 6;
const RIOT_ACT_CACHE_KEY = 'riot:content:active-act';

// リアルタイム性の高いデータ(現在のランク等)の保持時間。
// これがそのまま実データとの最大ズレになる(3分)。
const VOLATILE_TTL_SECONDS = 180;
const MMR_POLICY = { edge: VOLATILE_TTL_SECONDS };

// リーダーボードの保持時間。Riot の val-ranked-v1 は 10req/10s 制限なので、
// リージョン数 × この間隔なら十分収まる。
const LEADERBOARD_POLICY = { edge: 60 * 5, kv: 0 };

// competitiveTier(数値) → 表示名。shared/ranks.js の RANK_FILES のキーと
// 完全一致させること(ローカルPNGフォールバックが効く条件のため)。
// 24=Immortal1 〜 27=Radiant は estimateTier() と同じ数値体系(実測で確認済み)。
const TIER_ID_TO_NAME = {
  0: 'Unranked',
  3: 'Iron 1', 4: 'Iron 2', 5: 'Iron 3',
  6: 'Bronze 1', 7: 'Bronze 2', 8: 'Bronze 3',
  9: 'Silver 1', 10: 'Silver 2', 11: 'Silver 3',
  12: 'Gold 1', 13: 'Gold 2', 14: 'Gold 3',
  15: 'Platinum 1', 16: 'Platinum 2', 17: 'Platinum 3',
  18: 'Diamond 1', 19: 'Diamond 2', 20: 'Diamond 3',
  21: 'Ascendant 1', 22: 'Ascendant 2', 23: 'Ascendant 3',
  24: 'Immortal 1', 25: 'Immortal 2', 26: 'Immortal 3',
  27: 'Radiant',
};
// リーダーボード掲載境界(実測: apリージョンで24RR未満のImmortal1は掲載されない)。
const LEADERBOARD_MIN_TIER = 24;

// ACCOUNT-V1 はどのシャードからでも解決できる(実測: asiaシャードで ap リージョンの
// プレイヤーも解決できることを確認済み)ため固定する。
const ACCOUNT_SHARD = 'asia';
const ACCOUNT_CACHE_TTL_SECONDS = 60 * 60; // /valorant/v2/account と同じ1時間方針

// リーダーボード探索の窓サイズ(val-ranked-v1 の size 上限)と、1リクエストあたりの
// 探索上限(無料プランの Pages Functions はサブリクエスト50回/呼び出しが上限のため)。
const LEADERBOARD_WINDOW_SIZE = 200;
const MAX_LEADERBOARD_PROBES = 8;

// パスごとのキャッシュ方針を返す。null = キャッシュしない(素通し)。
//   edge : 保持秒数。ブラウザ(max-age)とエッジ(s-maxage)の両方に使う
//          (理由は cacheControlValue() のコメント参照)
//   kv   : Workers KV の expirationTtl 秒数。0 = KVを使わない
function getCachePolicy(pathname) {
  // マッチ詳細: 過去の試合結果は変化しないため長期キャッシュしてよい。
  // KVを使う唯一の /valorant 配下のパス。1試合につき1回だけ書き込まれ、以後は
  // 再利用されるので書き込み回数が積み上がらず、colo をまたいで効く価値も大きい。
  if (/^\/valorant\/v4\/match\/[^/]+\/[^/]+$/.test(pathname)) {
    return { edge: 60 * 60 * 24 * 7, kv: 60 * 60 * 24 * 30 };
  }
  // アカウント情報(名前/タグ → PUUID解決): 変化がまれ
  if (/^\/valorant\/v2\/account\//.test(pathname)) {
    return { edge: 60 * 60, kv: 0 };
  }
  // リーダーボード: 頻繁な更新は不要
  // v2は非推奨(ページング非対応でリージョン全体を返し数MBに肥大化するため、
  // クライアント側はv3+size/pageへ移行済み。v2は後方互換のため残すのみ)
  if (/^\/valorant\/v2\/leaderboard\//.test(pathname) || /^\/valorant\/v3\/leaderboard\//.test(pathname)) {
    return LEADERBOARD_POLICY;
  }
  // 現在のランク/MMR、マッチ一覧、MMR履歴: 変化しうるので短め
  if (
    /^\/valorant\/v1\/mmr\//.test(pathname) ||
    /^\/valorant\/v2\/mmr\//.test(pathname) ||
    /^\/valorant\/v1\/profile\//.test(pathname) ||
    /^\/valorant\/v4\/matches\//.test(pathname) ||
    /^\/valorant\/v1\/by-puuid\/mmr-history\//.test(pathname)
  ) {
    return { edge: VOLATILE_TTL_SECONDS, kv: 0 };
  }
  return null;
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

// クエリパラメータの並び順でキャッシュキーがずれないよう正規化し、
// api_key (クライアントの古いコードが付けてくる可能性がある) は除外する。
// この文字列は KV のキーとしてもそのまま使う(既存キーと互換を保つため変更しないこと)。
function buildCacheKey(url) {
  const normalized = new URLSearchParams(url.searchParams);
  normalized.delete('api_key');
  normalized.sort();
  const query = normalized.toString();
  return `${url.pathname}${query ? `?${query}` : ''}`;
}

// エッジキャッシュ(Cache API)のキーとして使う Request。
// 実ホスト名を使うので、プレビュー環境と本番でキャッシュが混ざることはない。
function edgeCacheKey(url, normalizedKey) {
  return new Request(`https://${url.host}${normalizedKey}`);
}

// ブラウザ(max-age)とエッジ(s-maxage)に同じ秒数を渡す。
//
// エッジから返るレスポンスには、そこで何秒保持されていたかが Age ヘッダに載る
// (実測で確認済み)。ブラウザは max-age - Age を残り寿命として扱うので、両者を
// 同じ値にしても実データとのズレがこの秒数を超えることはない。
// 逆に max-age をこれより短くすると、エッジで max-age 以上経過したレスポンスは
// 受け取った時点でブラウザにとって期限切れになり、ブラウザキャッシュが全く
// 効かなくなる(OBSオーバーレイの定期ポーリングを吸収できなくなる)。
function cacheControlValue(policy) {
  return `public, max-age=${policy.edge}, s-maxage=${policy.edge}`;
}

// エッジキャッシュへ保存する用のレスポンスを作る。
// CORSヘッダーは呼び出し元 Origin ごとに変わるため保存側には含めない
// (取り出したあと withCors() で毎回付け直す)。
function makeCacheableResponse(bodyText, policy, contentType, extraHeaders) {
  return new Response(bodyText, {
    status: 200,
    headers: {
      ...(extraHeaders || {}),
      'Content-Type': contentType || 'application/json',
      'Cache-Control': cacheControlValue(policy),
    },
  });
}

// 返却直前に CORS と X-Cache を付与する。
// cache.match() が返すレスポンスはヘッダーが immutable なので、必ず包み直してから設定する。
function withCors(response, origin, cacheStatus) {
  const out = new Response(response.body, response);
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    out.headers.set(key, value);
  }
  if (cacheStatus) {
    out.headers.set('X-Cache', cacheStatus);
  }
  return out;
}

// アクトIDをエッジキャッシュに置くための内部レスポンス。
// Cache API のキーには実在しない内部パスを使う(外部から叩かれても
// API 経路ではないので静的アセット側に流れて 404 になる)。
function makeActCacheResponse(actId) {
  return new Response(JSON.stringify({ actId }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, s-maxage=${RIOT_ACT_TTL_SECONDS}`,
    },
  });
}

// 現行アクトのIDを val-content-v1 から解決する。
// content-v1 のレスポンスは巨大なので、キャッシュには actId だけを保存する。
// アクトはリージョン共通なので content の取得は ap シャード固定でよい
// (content-v1 は 250req/10s と余裕があり、6時間に1回程度しか呼ばれない)。
//
// エッジ・KV の両方に置く。KV バインディングは Pages のプロジェクト設定でしか
// 追加できず未設定のこともあるため、KV が無くても colo 内で使い回せるようにする。
async function resolveActiveActId(env, ctx, riotKey, actCacheKeyRequest) {
  const cache = caches.default;

  const edgeHit = await cache.match(actCacheKeyRequest);
  if (edgeHit) {
    try {
      const cached = await edgeHit.json();
      if (cached && cached.actId) {
        return cached.actId;
      }
    } catch (err) {
      console.error('Edge act cache read failed:', err);
    }
  }

  if (env.VALORANT_CACHE) {
    try {
      const cached = await env.VALORANT_CACHE.get(RIOT_ACT_CACHE_KEY, 'json');
      if (cached && cached.actId) {
        // エッジにも載せておき、次回は KV を読まずに済むようにする
        ctx.waitUntil(
          cache
            .put(actCacheKeyRequest, makeActCacheResponse(cached.actId))
            .catch((err) => console.error('Edge act cache write failed:', err))
        );
        return cached.actId;
      }
    } catch (err) {
      console.error('KV act cache read failed:', err);
    }
  }

  // locale を指定すると全言語分の localizedNames が省略されレスポンスが大幅に縮む
  const response = await fetch('https://ap.api.riotgames.com/val/content/v1/contents?locale=en-US', {
    method: 'GET',
    headers: { 'X-Riot-Token': riotKey, Accept: 'application/json' },
  });
  if (!response.ok) {
    console.error(`Riot content-v1 request failed: ${response.status}`);
    return null;
  }

  const content = await response.json();
  const act = (content.acts || []).find((a) => a.isActive && a.type === 'act');
  if (!act || !act.id) {
    console.error('Riot content-v1: no active act found');
    return null;
  }

  ctx.waitUntil(
    cache
      .put(actCacheKeyRequest, makeActCacheResponse(act.id))
      .catch((err) => console.error('Edge act cache write failed:', err))
  );
  if (env.VALORANT_CACHE) {
    ctx.waitUntil(
      env.VALORANT_CACHE.put(RIOT_ACT_CACHE_KEY, JSON.stringify({ actId: act.id }), {
        expirationTtl: RIOT_ACT_TTL_SECONDS,
      }).catch((err) => {
        console.error('KV act cache write failed:', err);
      })
    );
  }
  return act.id;
}

// プレイヤーの tier (24=Immortal1 〜 27=Radiant) を求める。
// 通常は各プレイヤーの competitiveTier がそのまま使える(実レスポンスで全件
// 含まれることを確認済み)。欠けていた場合のみ tierDetails の startingIndex
// から順位ベースで補う。
//
// 注意: tierDetails.rankedRatingThreshold での判定はできない。Radiant かどうかは
// RR ではなくリーダーボード順位(上位N人)で決まるため、境界付近では同じ RR でも
// tier が分かれる(実測: ap の 499〜503位はいずれも rr=431 だが tier は 27/27/26/26/26)。
function estimateTier(player, tierDetails) {
  if (typeof player.competitiveTier === 'number' && player.competitiveTier > 0) {
    return player.competitiveTier;
  }

  // startingIndex は1始まりで leaderboardRank と同じ基準
  // (実測: tier 26 の startingIndex=501 に対し、501位のプレイヤーが tier 26)。
  // 順位以下で最大の startingIndex を持つ tier がそのプレイヤーの tier になる。
  if (typeof player.leaderboardRank === 'number' && player.leaderboardRank > 0) {
    const byPosition = Object.keys(tierDetails || {})
      .map((key) => ({ tier: Number(key), startingIndex: tierDetails[key].startingIndex }))
      .filter(
        (entry) =>
          Number.isFinite(entry.tier) &&
          typeof entry.startingIndex === 'number' &&
          entry.startingIndex <= player.leaderboardRank
      )
      .sort((a, b) => b.startingIndex - a.startingIndex);
    if (byPosition.length > 0) {
      return byPosition[0].tier;
    }
  }

  return 24; // 判定不能時は Immortal 1 (リーダーボード掲載者の最低 tier)
}

// Riot 公式レスポンスを HenrikDev v3 リーダーボード互換の形に変換する。
// クライアント (leaderboard.html) が参照するのは
// leaderboard_rank / tier / name / tag / rr の5フィールドのみ。
// 名前非公開のプレイヤーは gameName/tagLine が空になる(クライアント側で
// 'Unknown' 表示にフォールバックする)。
function transformRiotLeaderboard(riotJson, updatedAt) {
  const players = Array.isArray(riotJson.players) ? riotJson.players : [];
  return {
    status: 200,
    data: {
      updated_at: updatedAt,
      total_players: riotJson.totalPlayers ?? players.length,
      players: players.map((p) => ({
        puuid: p.puuid || '',
        name: p.gameName || '',
        tag: p.tagLine || '',
        leaderboard_rank: p.leaderboardRank,
        tier: estimateTier(p, riotJson.tierDetails),
        rr: p.rankedRating,
        wins: p.numberOfWins,
      })),
    },
  };
}

// ---- D1 (env.VALORANT_RR): 自前RR観測の読み書き ----
// バインディング未設定でも壊れないよう、全関数で env.VALORANT_RR の有無を確認する
// (KVバインディングと同じ運用方針。README参照)。

async function readRrCurrent(env, puuid) {
  if (!env.VALORANT_RR) return null;
  try {
    const row = await env.VALORANT_RR
      .prepare(
        'SELECT region, name, tag, tier, rr, last_change, leaderboard_rank, source, observed_at FROM rr_current WHERE player_key = ?'
      )
      .bind(puuid)
      .first();
    return row || null;
  } catch (err) {
    console.error('D1 rr_current read failed:', err);
    return null;
  }
}

// 書き込みは呼び出し元をブロックしないよう ctx.waitUntil() 内で行う(値は既に
// レスポンスに載せて返却済みのため、書き込み失敗はログのみで致命的にはしない)。
function upsertRrCurrentPromise(env, row) {
  return env.VALORANT_RR
    .prepare(
      `INSERT INTO rr_current (player_key, region, name, tag, tier, rr, last_change, leaderboard_rank, source, observed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_key) DO UPDATE SET
         region = excluded.region, name = excluded.name, tag = excluded.tag, tier = excluded.tier,
         rr = excluded.rr, last_change = excluded.last_change, leaderboard_rank = excluded.leaderboard_rank,
         source = excluded.source, observed_at = excluded.observed_at`
    )
    .bind(row.puuid, row.region, row.name, row.tag, row.tier, row.rr, row.lastChange, row.leaderboardRank, row.source, row.observedAt)
    .run();
}

function upsertRrCurrent(env, ctx, row) {
  if (!env.VALORANT_RR) return;
  ctx.waitUntil(upsertRrCurrentPromise(env, row).catch((err) => console.error('D1 rr_current write failed:', err)));
}

async function readRrHistory(env, puuid, limit) {
  if (!env.VALORANT_RR) return [];
  try {
    const result = await env.VALORANT_RR
      .prepare('SELECT match_id, tier, rr, rr_change FROM rr_history WHERE player_key = ? ORDER BY observed_at DESC LIMIT ?')
      .bind(puuid, limit)
      .all();
    return (result && result.results) || [];
  } catch (err) {
    console.error('D1 rr_history read failed:', err);
    return [];
  }
}

function insertRrHistory(env, ctx, row) {
  if (!env.VALORANT_RR || !row.matchId) return;
  ctx.waitUntil(
    env.VALORANT_RR
      .prepare(
        `INSERT INTO rr_history (player_key, match_id, tier, rr, rr_change, observed_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(player_key, match_id) DO NOTHING`
      )
      .bind(row.puuid, row.matchId, row.tier, row.rr, row.rrChange, row.observedAt, row.source)
      .run()
      .catch((err) => console.error('D1 rr_history write failed:', err))
  );
}

// ---- Riot puuid 解決 (ACCOUNT-V1) ----
// リーダーボードの puuid と ACCOUNT-V1 の puuid が完全一致することを実測済み
// (Murphyslaw#3b1 で照合)。name/tag は改名されうるが puuid は不変なので、
// D1 の結合キーには puuid を使う。
async function resolveRiotPuuid(url, name, tag, env, ctx, riotKey) {
  const cacheKeyRequest = edgeCacheKey(url, `/__cache/riot-account/${name.toLowerCase()}/${tag.toLowerCase()}`);
  const cache = caches.default;

  const edgeHit = await cache.match(cacheKeyRequest);
  if (edgeHit) {
    try {
      const cached = await edgeHit.json();
      if (cached && cached.puuid) return cached.puuid;
    } catch (err) {
      console.error('Edge account cache read failed:', err);
    }
  }

  const response = await fetch(
    `https://${ACCOUNT_SHARD}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
    { method: 'GET', headers: { 'X-Riot-Token': riotKey, Accept: 'application/json' } }
  );
  if (!response.ok) {
    console.error(`Riot account-v1 request failed: ${response.status}`);
    return null;
  }
  const account = await response.json();
  if (!account.puuid) return null;

  ctx.waitUntil(
    cache
      .put(
        cacheKeyRequest,
        new Response(JSON.stringify({ puuid: account.puuid }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, s-maxage=${ACCOUNT_CACHE_TTL_SECONDS}` },
        })
      )
      .catch((err) => console.error('Edge account cache write failed:', err))
  );
  return account.puuid;
}

// ---- リーダーボード上のプレイヤー探索 ----

async function fetchLeaderboardWindow(region, actId, startIndex, riotKey) {
  const response = await requestRiotLeaderboard(region, actId, LEADERBOARD_WINDOW_SIZE, Math.max(0, startIndex), riotKey);
  if (!response.ok) return null;
  return response.json();
}

function findByPuuid(players, puuid) {
  return (players || []).find((p) => p.puuid === puuid) || null;
}

// 前回の順位(D1の leaderboard_rank)の ±100 の窓を1回だけ見る。
// 定常ポーリングでは(順位が短時間で大きくは動かない前提で)ここで当たる想定で、
// 成功すれば探索は1リクエストで終わる。
async function probeRankWindow(region, actId, puuid, hintRank, riotKey) {
  const startIndex = Math.max(0, hintRank - 1 - Math.floor(LEADERBOARD_WINDOW_SIZE / 2));
  const json = await fetchLeaderboardWindow(region, actId, startIndex, riotKey);
  if (!json) return null;
  const player = findByPuuid(json.players, puuid);
  return player ? { player, tierDetails: json.tierDetails } : null;
}

// 同点(同RR)の別プレイヤーだった場合に、前後1窓だけ追加で確認する。
async function scanAdjacentWindows(region, actId, puuid, centerStartIndex, riotKey, probesUsed) {
  for (const offset of [-LEADERBOARD_WINDOW_SIZE, LEADERBOARD_WINDOW_SIZE]) {
    if (probesUsed >= MAX_LEADERBOARD_PROBES) break;
    const startIndex = centerStartIndex + offset;
    if (startIndex < 0) continue;
    probesUsed += 1;
    const json = await fetchLeaderboardWindow(region, actId, startIndex, riotKey);
    if (!json) continue;
    const found = findByPuuid(json.players, puuid);
    if (found) return { player: found, tierDetails: json.tierDetails };
  }
  return null;
}

// RRが順位に対して単調減少であること(実測で確認済み: rank1=954RR 〜 rank15000=24RR、
// 全区間で厳密に単調減少)を利用した二分探索。targetRr は前回観測値や HenrikDev の
// 値など「探索の足がかり」であり、プレイヤー自身の現在のRRとずれていてもよい
// (ずれていた場合は同点帯を前後1窓確認することで回収する)。
async function locateByRrBinarySearch(region, actId, puuid, targetRr, riotKey) {
  let lo = 0;
  let hi = 14999; // 実測値(total_players=15000)。多少ずれても総当たりより十分収束が速い
  let probes = 0;

  while (lo <= hi && probes < MAX_LEADERBOARD_PROBES) {
    const mid = Math.floor((lo + hi) / 2);
    const startIndex = Math.max(0, mid - Math.floor(LEADERBOARD_WINDOW_SIZE / 2));
    probes += 1;
    const json = await fetchLeaderboardWindow(region, actId, startIndex, riotKey);
    if (!json) {
      // リクエスト自体の失敗(レート制限等)。「末尾を超えた」と混同して hi を縮めると
      // 探索範囲が壊れ、実在するプレイヤーを見失う(429/403応答は空配列と違って
      // 位置の情報を何も持っていないため)。探索はここで打ち切り、呼び出し元が
      // HenrikDevへフォールバックする。
      return null;
    }
    if (!Array.isArray(json.players) || json.players.length === 0) {
      hi = mid - 1; // 正常応答だが空 = 掲載範囲の末尾を超えた、とみなす
      continue;
    }

    const players = json.players;
    const found = findByPuuid(players, puuid);
    if (found) return { player: found, tierDetails: json.tierDetails };

    const windowMaxRr = players[0].rankedRating;
    const windowMinRr = players[players.length - 1].rankedRating;

    if (targetRr > windowMaxRr) {
      hi = mid - 1;
    } else if (targetRr < windowMinRr) {
      lo = mid + 1;
    } else {
      // 目標RR帯には来ているが同点の別プレイヤーだった
      return scanAdjacentWindows(region, actId, puuid, startIndex, riotKey, probes);
    }
  }
  return null;
}

// そのプレイヤーの直近のコンペティティブマッチIDを取得する(rr_history に紐付けるため)。
// 一覧は既に新しい順で返る(実測確認済み)が、念のため gameStartTimeMillis でも並べ直す。
async function fetchLatestCompetitiveMatchId(region, puuid, riotKey) {
  const response = await fetch(`https://${region}.api.riotgames.com/val/match/v1/matchlists/by-puuid/${puuid}`, {
    method: 'GET',
    headers: { 'X-Riot-Token': riotKey, Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const json = await response.json();
  const history = Array.isArray(json.history) ? json.history : [];
  const competitive = history
    .filter((h) => h.queueId === 'competitive')
    .sort((a, b) => (b.gameStartTimeMillis || 0) - (a.gameStartTimeMillis || 0));
  return competitive.length > 0 ? competitive[0].matchId : null;
}

// 初回アクセス(D1に前回値がない)でRiotリーダーボードを探索するための足がかりとして、
// HenrikDev の現在のMMRを一度だけ取得する。tier が Immortal1未満ならリーダーボードに
// 掲載されえないため、その場で諦めさせる。
async function fetchHenrikCurrentMmrSeed(region, name, tag, env) {
  if (!env.HENRIKDEV_API_KEY) return null;
  const upstreamUrl = new URL(`${UPSTREAM_HOST}/valorant/v2/mmr/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
  upstreamUrl.searchParams.set('api_key', env.HENRIKDEV_API_KEY);
  try {
    const response = await fetch(upstreamUrl.toString(), { method: 'GET', headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const json = await response.json();
    const currentData = json && json.data && json.data.current_data;
    if (!currentData || typeof currentData.currenttier !== 'number') return null;
    return { tier: currentData.currenttier, rr: currentData.ranking_in_tier || 0 };
  } catch (err) {
    console.error('Henrik MMR seed lookup failed:', err);
    return null;
  }
}

// Riot 経路でのMMR解決の本体。
//
// 手順:
//  1) name/tag → puuid (ACCOUNT-V1、エッジに1時間キャッシュ)
//  2) D1 の前回観測(rr_current)を読む
//  3) 前回の順位ヒントがあれば ±100 窓を1回だけ試す(定常状態はここで決着)
//  4) 外れた場合、前回RR(または初回は HenrikDev の値)を足がかりに二分探索
//  5) 見つかった場合、前回値との差分から mmr_change_to_last_game を算出し、
//     変化があった時だけ D1 に書き込む(変化なしのポーリングでは書き込みゼロ)
//
// 戻り値: { tier, rr, mmrChange, source } または null(リーダーボードに存在しない
// = Immortal1未満、もしくは一時的な失敗。呼び出し元が HenrikDev へフォールバックする)。
async function resolveRiotMmrForPlayer(url, region, name, tag, env, ctx, riotKey) {
  const puuid = await resolveRiotPuuid(url, name, tag, env, ctx, riotKey);
  if (!puuid) return null;

  const actCacheKeyRequest = edgeCacheKey(url, `/__cache/${RIOT_ACT_CACHE_KEY}`);
  const actId = await resolveActiveActId(env, ctx, riotKey, actCacheKeyRequest);
  if (!actId) return null;

  const prev = await readRrCurrent(env, puuid);

  let located = null;
  if (prev && typeof prev.leaderboard_rank === 'number') {
    located = await probeRankWindow(region, actId, puuid, prev.leaderboard_rank, riotKey);
  }

  if (!located && prev && typeof prev.rr === 'number') {
    located = await locateByRrBinarySearch(region, actId, puuid, prev.rr, riotKey);
  }

  if (!located) {
    // ここに来るのは (a) 前回値が無い完全な初回、または (b) 前回のRR/順位を足がかりに
    // した探索が外れた場合(大きくRRが動いた等)。いずれもHenrikDevの「現在の」値を
    // 新しい足がかりに一度だけ再探索する。(b)を素通しすると、前回値が実態からずれた
    // ままD1に居座り続け、以後ずっと探索が失敗し続ける(自己修復しない)ため、
    // 前回値の有無にかかわらずこの再探索を行う。
    const seed = await fetchHenrikCurrentMmrSeed(region, name, tag, env);
    if (!seed || seed.tier < LEADERBOARD_MIN_TIER) {
      return null; // Immortal1未満、またはHenrikDevも失敗 → 呼び出し元がHenrikDevへ完全フォールバック
    }
    located = await locateByRrBinarySearch(region, actId, puuid, seed.rr, riotKey);
    if (!located) {
      // それでも見つからなかったがHenrikDevの値は使える。次回の探索の足がかりとして
      // D1に種をまいておく(leaderboard_rankはnullのまま = 次回もrrアンカーで探索)。
      // last_changeは前回値を引き継ぐ(この応答自体はHenrikDevの値をそのまま出しており、
      // 「今回検出した差分」ではないため mmrChange は undefined のまま返す)。
      upsertRrCurrent(env, ctx, {
        puuid, region, name, tag, tier: seed.tier, rr: seed.rr,
        lastChange: prev ? prev.last_change : null, leaderboardRank: null, source: 'henrik', observedAt: Date.now(),
      });
      return { tier: seed.tier, rr: seed.rr, mmrChange: undefined, source: 'henrik' };
    }
  }

  const { player, tierDetails } = located;
  const tier = estimateTier(player, tierDetails);
  const rr = player.rankedRating;
  const rank = player.leaderboardRank;
  const now = Date.now();

  if (!prev) {
    upsertRrCurrent(env, ctx, {
      puuid, region, name, tag, tier, rr, lastChange: null, leaderboardRank: rank, source: 'riot', observedAt: now,
    });
    return { tier, rr, mmrChange: undefined, source: 'riot' };
  }

  if (prev.rr === rr && prev.tier === tier) {
    // 新しい試合の形跡なし。前回の増減値をそのまま引き継ぐ(D1書き込みなし)
    const carriedChange = prev.last_change === null || prev.last_change === undefined ? undefined : prev.last_change;
    return { tier, rr, mmrChange: carriedChange, source: 'riot' };
  }

  const mmrChange = rr - prev.rr;
  upsertRrCurrent(env, ctx, {
    puuid, region, name, tag, tier, rr, lastChange: mmrChange, leaderboardRank: rank, source: 'riot', observedAt: now,
  });

  try {
    const matchId = await fetchLatestCompetitiveMatchId(region, puuid, riotKey);
    if (matchId) {
      insertRrHistory(env, ctx, { puuid, matchId, tier, rr, rrChange: mmrChange, observedAt: now, source: 'observed' });
    }
  } catch (err) {
    // rr_history への記録漏れは mmr-history の1件が欠けるだけで、現在値の表示には影響しない
    console.error('matchlist lookup for rr_history failed:', err);
  }

  return { tier, rr, mmrChange, source: 'riot' };
}

// Riotの解決結果(またはHenrikDevのseed)をHenrik互換のdataオブジェクトに整形する。
// 注意: images は返さない。消費側3箇所(js/overlay/render.js・preview.js・
// valorant-stats-tracker/js/render.js)は images が無ければローカルPNGにフォールバック
// する実装になっており、valorant-api.com のエピソードUUIDに依存せずに済む。
function buildMmrPayload(result) {
  const payload = {
    currenttier: result.tier,
    currenttierpatched: TIER_ID_TO_NAME[result.tier] || 'Unrated',
    ranking_in_tier: result.rr,
  };
  if (result.mmrChange !== undefined) {
    payload.mmr_change_to_last_game = result.mmrChange;
  }
  return payload;
}

function formatMmrResponseV1(result) {
  return { status: 200, data: buildMmrPayload(result) };
}

function formatMmrResponseV2(result, name, tag) {
  return { status: 200, data: { name, tag, current_data: buildMmrPayload(result) } };
}

function invalidRegionResponse(region, origin) {
  return withCors(
    new Response(JSON.stringify({ error: `Unsupported region: ${region}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }),
    origin
  );
}

// HenrikDev の /v1/mmr または /v2/mmr への素通しフォールバック。
async function fetchHenrikMmrFallback(version, region, name, tag, env, ctx, origin, cacheKeyRequest) {
  if (!env.HENRIKDEV_API_KEY) {
    return withCors(
      new Response(JSON.stringify({ error: 'No upstream API key is configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
      origin
    );
  }

  const henrikPath = version === 'v2' ? 'v2/mmr' : 'v1/mmr';
  const upstreamUrl = new URL(`${UPSTREAM_HOST}/valorant/${henrikPath}/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
  upstreamUrl.searchParams.set('api_key', env.HENRIKDEV_API_KEY);

  const upstreamResponse = await fetch(upstreamUrl.toString(), { method: 'GET', headers: { Accept: 'application/json' } });
  const bodyText = await upstreamResponse.text();
  const contentType = upstreamResponse.headers.get('Content-Type') || 'application/json';
  const sourceHeader = { 'X-MMR-Source': 'henrik-fallback' };

  if (upstreamResponse.ok) {
    ctx.waitUntil(
      caches.default
        .put(cacheKeyRequest, makeCacheableResponse(bodyText, MMR_POLICY, contentType, sourceHeader))
        .catch((err) => console.error('Edge cache write failed:', err))
    );
  }

  return withCors(
    new Response(bodyText, {
      status: upstreamResponse.status,
      headers: {
        ...sourceHeader,
        'Content-Type': contentType,
        'Cache-Control': upstreamResponse.ok ? cacheControlValue(MMR_POLICY) : 'no-store',
      },
    }),
    origin,
    'MISS'
  );
}

// /riot/mmr/{v1|v2}/{region}/{name}/{tag} のエントリポイント。
async function handleRiotMmr(version, region, rawName, rawTag, url, env, ctx, origin) {
  if (!RIOT_REGIONS.has(region)) {
    return invalidRegionResponse(region, origin);
  }
  const name = decodeURIComponent(rawName);
  const tag = decodeURIComponent(rawTag);
  const cacheKeyRequest = edgeCacheKey(url, `/riot/mmr/${version}/${region}/${name.toLowerCase()}/${tag.toLowerCase()}`);
  const cache = caches.default;

  const edgeHit = await cache.match(cacheKeyRequest);
  if (edgeHit) {
    return withCors(edgeHit, origin, 'HIT-EDGE');
  }

  if (env.RIOT_API_KEY) {
    try {
      const result = await resolveRiotMmrForPlayer(url, region, name, tag, env, ctx, env.RIOT_API_KEY);
      if (result) {
        const payload = version === 'v2' ? formatMmrResponseV2(result, name, tag) : formatMmrResponseV1(result);
        const bodyText = JSON.stringify(payload);
        const sourceHeader = { 'X-MMR-Source': result.source };
        ctx.waitUntil(
          cache
            .put(cacheKeyRequest, makeCacheableResponse(bodyText, MMR_POLICY, 'application/json', sourceHeader))
            .catch((err) => console.error('Edge cache write failed:', err))
        );
        return withCors(
          new Response(bodyText, {
            status: 200,
            headers: { ...sourceHeader, 'Content-Type': 'application/json', 'Cache-Control': cacheControlValue(MMR_POLICY) },
          }),
          origin,
          'MISS'
        );
      }
    } catch (err) {
      console.error('Riot MMR route failed, falling back to Henrik:', err);
    }
  }

  return fetchHenrikMmrFallback(version, region, name, tag, env, ctx, origin, cacheKeyRequest);
}

// HenrikDev の mmr-history を1回だけ取得し、D1にseedとして書き込みつつ返す
// (次回以降は D1 から直接返せるようになる)。HenrikDev側はpuuidがHenrik固有形式
// (36文字UUID)なので、まず /v2/account で解決する。
async function seedRrHistoryFromHenrik(region, name, tag, puuid, env, ctx) {
  if (!env.HENRIKDEV_API_KEY) return [];
  try {
    const accountUrl = new URL(`${UPSTREAM_HOST}/valorant/v2/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
    accountUrl.searchParams.set('api_key', env.HENRIKDEV_API_KEY);
    const accountRes = await fetch(accountUrl.toString(), { method: 'GET', headers: { Accept: 'application/json' } });
    if (!accountRes.ok) return [];
    const account = await accountRes.json();
    const henrikPuuid = account && account.data && account.data.puuid;
    if (!henrikPuuid) return [];

    const histUrl = new URL(`${UPSTREAM_HOST}/valorant/v1/by-puuid/mmr-history/${region}/${henrikPuuid}`);
    histUrl.searchParams.set('api_key', env.HENRIKDEV_API_KEY);
    const histRes = await fetch(histUrl.toString(), { method: 'GET', headers: { Accept: 'application/json' } });
    if (!histRes.ok) return [];
    const json = await histRes.json();
    const entries = Array.isArray(json.data) ? json.data : [];

    const now = Date.now();
    const rows = entries
      .filter((e) => e.match_id && typeof e.currenttier === 'number')
      .map((e) => ({
        match_id: e.match_id,
        tier: e.currenttier,
        rr: e.ranking_in_tier || 0,
        rr_change: typeof e.mmr_change_to_last_game === 'number' ? e.mmr_change_to_last_game : null,
      }));

    for (const row of rows) {
      insertRrHistory(env, ctx, {
        puuid, matchId: row.match_id, tier: row.tier, rr: row.rr, rrChange: row.rr_change, observedAt: now, source: 'henrik-seed',
      });
    }
    return rows;
  } catch (err) {
    console.error('Henrik mmr-history seed failed:', err);
    return [];
  }
}

// puuid解決すら失敗した場合の完全なHenrikDevフォールバック
// (account解決 → mmr-history の2段。既存の js/api.js の実装と同じ構造)。
async function fetchHenrikMmrHistoryFallback(region, name, tag, env, ctx, origin, cacheKeyRequest) {
  if (!env.HENRIKDEV_API_KEY) {
    return withCors(
      new Response(JSON.stringify({ error: 'No upstream API key is configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
      origin
    );
  }
  try {
    const accountUrl = new URL(`${UPSTREAM_HOST}/valorant/v2/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
    accountUrl.searchParams.set('api_key', env.HENRIKDEV_API_KEY);
    const accountRes = await fetch(accountUrl.toString(), { method: 'GET', headers: { Accept: 'application/json' } });
    if (!accountRes.ok) {
      const errText = await accountRes.text();
      return withCors(
        new Response(errText, { status: accountRes.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }),
        origin
      );
    }
    const account = await accountRes.json();
    const henrikPuuid = account && account.data && account.data.puuid;
    if (!henrikPuuid) {
      return withCors(
        new Response(JSON.stringify({ status: 404, data: [] }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        }),
        origin
      );
    }

    const histUrl = new URL(`${UPSTREAM_HOST}/valorant/v1/by-puuid/mmr-history/${region}/${henrikPuuid}`);
    histUrl.searchParams.set('api_key', env.HENRIKDEV_API_KEY);
    const histRes = await fetch(histUrl.toString(), { method: 'GET', headers: { Accept: 'application/json' } });
    const bodyText = await histRes.text();
    const contentType = histRes.headers.get('Content-Type') || 'application/json';
    const sourceHeader = { 'X-MMR-Source': 'henrik-fallback' };

    if (histRes.ok) {
      ctx.waitUntil(
        caches.default
          .put(cacheKeyRequest, makeCacheableResponse(bodyText, MMR_POLICY, contentType, sourceHeader))
          .catch((err) => console.error('Edge cache write failed:', err))
      );
    }

    return withCors(
      new Response(bodyText, {
        status: histRes.status,
        headers: {
          ...sourceHeader,
          'Content-Type': contentType,
          'Cache-Control': histRes.ok ? cacheControlValue(MMR_POLICY) : 'no-store',
        },
      }),
      origin,
      'MISS'
    );
  } catch (err) {
    console.error('Henrik mmr-history fallback failed:', err);
    return withCors(
      new Response(JSON.stringify({ error: 'Upstream request failed' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
      origin
    );
  }
}

// /riot/mmr-history/{region}/{name}/{tag} のエントリポイント。
async function handleRiotMmrHistory(region, rawName, rawTag, url, env, ctx, origin) {
  if (!RIOT_REGIONS.has(region)) {
    return invalidRegionResponse(region, origin);
  }
  const name = decodeURIComponent(rawName);
  const tag = decodeURIComponent(rawTag);
  const cacheKeyRequest = edgeCacheKey(url, `/riot/mmr-history/${region}/${name.toLowerCase()}/${tag.toLowerCase()}`);
  const cache = caches.default;

  const edgeHit = await cache.match(cacheKeyRequest);
  if (edgeHit) {
    return withCors(edgeHit, origin, 'HIT-EDGE');
  }

  if (env.RIOT_API_KEY) {
    try {
      const puuid = await resolveRiotPuuid(url, name, tag, env, ctx, env.RIOT_API_KEY);
      if (puuid) {
        let rows = await readRrHistory(env, puuid, 20);
        if (rows.length === 0) {
          rows = await seedRrHistoryFromHenrik(region, name, tag, puuid, env, ctx);
        }
        const payload = {
          status: 200,
          data: rows.map((r) => {
            const entry = {
              match_id: r.match_id,
              currenttier: r.tier,
              currenttierpatched: TIER_ID_TO_NAME[r.tier] || 'Unrated',
              ranking_in_tier: r.rr,
            };
            if (typeof r.rr_change === 'number') {
              entry.mmr_change_to_last_game = r.rr_change;
            }
            return entry;
          }),
        };
        const bodyText = JSON.stringify(payload);
        const sourceHeader = { 'X-MMR-Source': 'riot' };
        ctx.waitUntil(
          cache
            .put(cacheKeyRequest, makeCacheableResponse(bodyText, MMR_POLICY, 'application/json', sourceHeader))
            .catch((err) => console.error('Edge cache write failed:', err))
        );
        return withCors(
          new Response(bodyText, {
            status: 200,
            headers: { ...sourceHeader, 'Content-Type': 'application/json', 'Cache-Control': cacheControlValue(MMR_POLICY) },
          }),
          origin,
          'MISS'
        );
      }
    } catch (err) {
      console.error('Riot mmr-history route failed, falling back to Henrik:', err);
    }
  }

  return fetchHenrikMmrHistoryFallback(region, name, tag, env, ctx, origin, cacheKeyRequest);
}

function requestRiotLeaderboard(region, actId, size, startIndex, riotKey) {
  const url = `https://${region}.api.riotgames.com/val/ranked/v1/leaderboards/by-act/${actId}?size=${size}&startIndex=${startIndex}`;
  return fetch(url, {
    method: 'GET',
    headers: { 'X-Riot-Token': riotKey, Accept: 'application/json' },
  });
}

// Riot 公式経路でリーダーボードを取得し、Henrik 互換形式で返す。
// 失敗時は null を返し、呼び出し元が Henrik フォールバックに切り替える。
async function fetchRiotLeaderboard(region, size, startIndex, env, ctx, riotKey, actCacheKeyRequest) {
  let actId = await resolveActiveActId(env, ctx, riotKey, actCacheKeyRequest);
  if (!actId) return null;

  let response = await requestRiotLeaderboard(region, actId, size, startIndex, riotKey);

  // アクト切替直後はキャッシュ済み actId が失効して 400/404 になるため、
  // キャッシュを破棄して再解決し、1回だけリトライする。
  // エッジ側も消さないと古い actId を掴んだまま TTL 切れまで失敗し続ける。
  if (response.status === 400 || response.status === 404) {
    await caches.default.delete(actCacheKeyRequest).catch((err) => {
      console.error('Edge act cache delete failed:', err);
    });
    if (env.VALORANT_CACHE) {
      await env.VALORANT_CACHE.delete(RIOT_ACT_CACHE_KEY).catch((err) => {
        console.error('KV act cache delete failed:', err);
      });
    }
    actId = await resolveActiveActId(env, ctx, riotKey, actCacheKeyRequest);
    if (!actId) return null;
    response = await requestRiotLeaderboard(region, actId, size, startIndex, riotKey);
  }

  if (!response.ok) {
    console.error(`Riot ranked-v1 request failed: ${response.status}`);
    return null;
  }
  return transformRiotLeaderboard(await response.json(), new Date().toISOString());
}

// Riot 経路が使えない/失敗した場合の HenrikDev v3 フォールバック。
// もともと Henrik v3 形状なので無変換で返す。
async function fetchHenrikLeaderboardFallback(region, size, page, env, ctx, origin, cacheKeyRequest) {
  if (!env.HENRIKDEV_API_KEY) {
    return withCors(
      new Response(JSON.stringify({ error: 'No upstream API key is configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
      origin
    );
  }

  const upstreamUrl = new URL(`${UPSTREAM_HOST}/valorant/v3/leaderboard/${region}/pc`);
  upstreamUrl.searchParams.set('size', String(size));
  upstreamUrl.searchParams.set('page', String(page));
  upstreamUrl.searchParams.set('api_key', env.HENRIKDEV_API_KEY);

  const upstreamResponse = await fetch(upstreamUrl.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const bodyText = await upstreamResponse.text();
  const contentType = upstreamResponse.headers.get('Content-Type') || 'application/json';
  const sourceHeader = { 'X-Leaderboard-Source': 'henrik-fallback' };

  if (upstreamResponse.ok) {
    ctx.waitUntil(
      caches.default
        .put(cacheKeyRequest, makeCacheableResponse(bodyText, LEADERBOARD_POLICY, contentType, sourceHeader))
        .catch((err) => console.error('Edge cache write failed:', err))
    );
  }

  // 両経路失敗時は Henrik のエラーを status ごと返す
  // (クライアント側の 429 リトライ等の既存ハンドリングをそのまま活かす)
  return withCors(
    new Response(bodyText, {
      status: upstreamResponse.status,
      headers: {
        ...sourceHeader,
        'Content-Type': contentType,
        'Cache-Control': upstreamResponse.ok ? cacheControlValue(LEADERBOARD_POLICY) : 'no-store',
      },
    }),
    origin,
    'MISS'
  );
}

// /riot/* 経路のルーター。受け付けるのは以下のみ
// (Riot API 全体を素通しする汎用プロキシにはしない)。
//   /riot/leaderboard/{region}
//   /riot/mmr/{v1|v2}/{region}/{name}/{tag}
//   /riot/mmr-history/{region}/{name}/{tag}
async function handleRiotRequest(url, env, ctx, origin) {
  const path = url.pathname;

  const leaderboardMatch = path.match(/^\/riot\/leaderboard\/([a-z]+)$/);
  if (leaderboardMatch) {
    return handleRiotLeaderboard(leaderboardMatch[1], url, env, ctx, origin);
  }

  const mmrMatch = path.match(/^\/riot\/mmr\/(v1|v2)\/([a-z]+)\/([^/]+)\/([^/]+)$/);
  if (mmrMatch) {
    const [, version, region, rawName, rawTag] = mmrMatch;
    return handleRiotMmr(version, region, rawName, rawTag, url, env, ctx, origin);
  }

  const historyMatch = path.match(/^\/riot\/mmr-history\/([a-z]+)\/([^/]+)\/([^/]+)$/);
  if (historyMatch) {
    const [, region, rawName, rawTag] = historyMatch;
    return handleRiotMmrHistory(region, rawName, rawTag, url, env, ctx, origin);
  }

  return withCors(new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } }), origin);
}

async function handleRiotLeaderboard(region, url, env, ctx, origin) {
  if (!RIOT_REGIONS.has(region)) {
    return invalidRegionResponse(region, origin);
  }

  const size = Math.min(Math.max(parseInt(url.searchParams.get('size'), 10) || 100, 1), 200);
  const page = Math.max(parseInt(url.searchParams.get('page'), 10) || 1, 1);
  // Henrik はページ番号、Riot は開始インデックスなのでここで変換する
  const startIndex = (page - 1) * size;

  // クエリの並び順や省略に左右されないよう、正規化した固定形式のキーを使う
  const cacheKeyRequest = edgeCacheKey(url, `/riot/leaderboard/${region}?page=${page}&size=${size}`);
  const cache = caches.default;

  const edgeHit = await cache.match(cacheKeyRequest);
  if (edgeHit) {
    return withCors(edgeHit, origin, 'HIT-EDGE');
  }

  // RIOT_API_KEY 未設定でも 500 にせず Henrik へフォールバックする
  // (secret 登録前に先行デプロイしても壊れない)
  if (env.RIOT_API_KEY) {
    try {
      const actCacheKeyRequest = edgeCacheKey(url, `/__cache/${RIOT_ACT_CACHE_KEY}`);
      const result = await fetchRiotLeaderboard(
        region, size, startIndex, env, ctx, env.RIOT_API_KEY, actCacheKeyRequest
      );
      if (result) {
        const bodyText = JSON.stringify(result);
        const sourceHeader = { 'X-Leaderboard-Source': 'riot' };
        ctx.waitUntil(
          cache
            .put(cacheKeyRequest, makeCacheableResponse(bodyText, LEADERBOARD_POLICY, 'application/json', sourceHeader))
            .catch((err) => console.error('Edge cache write failed:', err))
        );
        return withCors(
          new Response(bodyText, {
            status: 200,
            headers: {
              ...sourceHeader,
              'Content-Type': 'application/json',
              'Cache-Control': cacheControlValue(LEADERBOARD_POLICY),
            },
          }),
          origin,
          'MISS'
        );
      }
    } catch (err) {
      console.error('Riot leaderboard route failed, falling back to Henrik:', err);
    }
  }

  return fetchHenrikLeaderboardFallback(region, size, page, env, ctx, origin, cacheKeyRequest);
}

// /valorant/* 経路: HenrikDev への素通しプロキシ
async function handleValorantRequest(url, env, ctx, origin) {
  if (!env.HENRIKDEV_API_KEY) {
    return withCors(
      new Response(JSON.stringify({ error: 'HENRIKDEV_API_KEY is not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
      origin
    );
  }

  const policy = getCachePolicy(url.pathname);
  const normalizedKey = buildCacheKey(url);
  const cache = caches.default;
  const cacheKeyRequest = policy ? edgeCacheKey(url, normalizedKey) : null;
  const kvEnabled = !!policy && policy.kv > 0 && !!env.VALORANT_CACHE;

  if (policy) {
    // 第一層: エッジキャッシュ(無料・操作回数の上限なし)
    const edgeHit = await cache.match(cacheKeyRequest);
    if (edgeHit) {
      return withCors(edgeHit, origin, 'HIT-EDGE');
    }

    // 第二層: Workers KV(マッチ詳細のみ)
    if (kvEnabled) {
      const kvBody = await env.VALORANT_CACHE.get(normalizedKey, 'text');
      if (kvBody !== null) {
        // 次回以降は無料のエッジキャッシュで返せるよう昇格させておく
        ctx.waitUntil(
          cache
            .put(cacheKeyRequest, makeCacheableResponse(kvBody, policy))
            .catch((err) => console.error('Edge cache write failed:', err))
        );
        return withCors(makeCacheableResponse(kvBody, policy), origin, 'HIT-KV');
      }
    }
  }

  const upstreamUrl = new URL(UPSTREAM_HOST + url.pathname);
  upstreamUrl.search = url.search;
  // クライアントが api_key を付けて送ってきても無視し、こちらの秘密鍵で必ず上書きする
  upstreamUrl.searchParams.delete('api_key');
  upstreamUrl.searchParams.set('api_key', env.HENRIKDEV_API_KEY);

  const upstreamResponse = await fetch(upstreamUrl.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  const bodyText = await upstreamResponse.text();
  const contentType = upstreamResponse.headers.get('Content-Type') || 'application/json';
  const cacheable = !!policy && upstreamResponse.ok;

  // 成功レスポンスのみキャッシュする(エラー/レート制限応答は保存しない)。
  if (cacheable) {
    ctx.waitUntil(
      cache
        .put(cacheKeyRequest, makeCacheableResponse(bodyText, policy, contentType))
        .catch((err) => console.error('Edge cache write failed:', err))
    );
    // KV書き込みが失敗しても(例: 無料枠の1,000回/日の上限超過で429)、
    // レスポンス自体は既に返しているので致命的にはならない。ログにだけ残す。
    if (kvEnabled) {
      ctx.waitUntil(
        env.VALORANT_CACHE.put(normalizedKey, bodyText, { expirationTtl: policy.kv }).catch((err) => {
          console.error('KV cache write failed:', err);
        })
      );
    }
  }

  return withCors(
    new Response(bodyText, {
      status: upstreamResponse.status,
      headers: {
        'Content-Type': contentType,
        // キャッシュ対象外・エラー応答はブラウザにも保持させない
        'Cache-Control': cacheable ? cacheControlValue(policy) : 'no-store',
      },
    }),
    origin,
    'MISS'
  );
}

// Pages Functions のエントリポイント。context は request/env のほか
// waitUntil() と next() を持つ(next() は静的アセットへのフォールバック)。
export async function onRequest(context) {
  const { request, env, next } = context;
  const origin = request.headers.get('Origin') || '';
  const url = new URL(request.url);

  const isApiPath = url.pathname.startsWith('/valorant/') || url.pathname.startsWith('/riot/');
  if (!isApiPath) {
    // API 経路以外は public/ の静的アセット(説明ページ)に任せる
    return next();
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method !== 'GET') {
    return withCors(new Response('Method Not Allowed', { status: 405 }), origin);
  }

  if (url.pathname.startsWith('/riot/')) {
    return handleRiotRequest(url, env, context, origin);
  }
  return handleValorantRequest(url, env, context, origin);
}
