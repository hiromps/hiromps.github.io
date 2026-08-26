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
// - /valorant/* : HenrikDev への素通しプロキシ。per-player MMR やマッチ履歴など、
//   Riot 公式キーのスコープ(content/ranked/status)では賄えないデータはこちら。
// - /riot/leaderboard/{region} : Riot 公式 val-ranked-v1 を叩き、レスポンスを
//   HenrikDev v3 リーダーボード互換の形に変換して返す独自エンドポイント。
//   Riot 側が失敗した場合は HenrikDev v3 に自動フォールバックする。
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

// リーダーボードの保持時間。Riot の val-ranked-v1 は 10req/10s 制限なので、
// リージョン数 × この間隔なら十分収まる。
const LEADERBOARD_POLICY = { edge: 60 * 5, kv: 0 };

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

// /riot/* 経路のエントリポイント。受け付けるのは /riot/leaderboard/{region} のみ
// (Riot API 全体を素通しする汎用プロキシにはしない)。
async function handleRiotRequest(url, env, ctx, origin) {
  const match = url.pathname.match(/^\/riot\/leaderboard\/([a-z]+)$/);
  if (!match) {
    return withCors(new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } }), origin);
  }

  const region = match[1];
  if (!RIOT_REGIONS.has(region)) {
    return withCors(
      new Response(JSON.stringify({ error: `Unsupported region: ${region}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
      origin
    );
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
