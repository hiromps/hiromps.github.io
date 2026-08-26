// VALORANT API プロキシ + キャッシュ (Cloudflare Workers)
//
// 目的:
// 1) ブラウザから API を直接叩くとキーがソース/通信内容にそのまま露出して
//    しまうため、実キーはこの Worker の secret にのみ保持する。
//    - env.HENRIKDEV_API_KEY: HenrikDev API 用 (/valorant/* 経路)
//    - env.RIOT_API_KEY:      Riot 公式 API 用 (/riot/* 経路)
// 2) 同じ問い合わせを Workers KV でキャッシュし、アップストリームへの実際の
//    リクエスト数を減らす(レート制限に引っかかりにくくする)。
//
// 経路は2系統:
// - /valorant/* : HenrikDev への素通しプロキシ(従来通り)。per-player MMR や
//   マッチ履歴など、Riot 公式キーのスコープ(content/ranked/status)では
//   賄えないデータはこちらを使い続ける。
// - /riot/leaderboard/{region} : Riot 公式 val-ranked-v1 を叩き、レスポンスを
//   HenrikDev v3 リーダーボード互換の形に変換して返す Worker 独自エンドポイント。
//   Riot 側が失敗した場合は HenrikDev v3 に自動フォールバックする。

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
// リーダーボードのTTLは既存のHenrik v3リーダーボード(5分)と同じにする。
// val-ranked-v1 のレート制限は 10req/10s なので、リージョン数×5分キャッシュで十分収まる。
const RIOT_LEADERBOARD_TTL_SECONDS = 60 * 5;
// 現行アクトIDのキャッシュ。アクトは数週間単位でしか切り替わらないので長めでよい。
// 切替直後は leaderboard が 400/404 を返すため、その時にキャッシュを破棄して再解決する。
const RIOT_ACT_TTL_SECONDS = 60 * 60 * 6;
const RIOT_ACT_CACHE_KEY = 'riot:content:active-act';

// リアルタイム性の高いデータ(現在のランク等)のキャッシュ保持時間。
// 注意: OBSオーバーレイの自動更新間隔(既定60秒, js/overlay/auto-update.js)と
// ほぼ一致する値にすると、ポーリングのたびにキャッシュが切れて毎回 KV.put() が
// 走ってしまう(=Workers KV の無料枠 1,000 回/日の書き込み上限をすぐ超過する)。
// ポーリング間隔より十分長く取ることで、同一プレイヤーへの連続ポーリングは
// ほとんど HIT にし、実際の書き込み回数を抑える。
const VOLATILE_TTL_SECONDS = 180;

// パスごとにキャッシュ保持時間(秒)を決める。0 = キャッシュしない(素通し)。
function getCacheTtlSeconds(pathname) {
  // マッチ詳細: 過去の試合結果は変化しないため長期キャッシュしてよい
  if (/^\/valorant\/v4\/match\/[^/]+\/[^/]+$/.test(pathname)) {
    return 60 * 60 * 24 * 30; // 30日
  }
  // アカウント情報(名前/タグ → PUUID解決): 変化がまれ
  if (/^\/valorant\/v2\/account\//.test(pathname)) {
    return 60 * 60; // 1時間
  }
  // リーダーボード: 頻繁な更新は不要
  // v2は非推奨(ページング非対応でリージョン全体を返し数MBに肥大化するため、
  // クライアント側はv3+size/pageへ移行済み。v2は後方互換のため残すのみ)
  if (/^\/valorant\/v2\/leaderboard\//.test(pathname) || /^\/valorant\/v3\/leaderboard\//.test(pathname)) {
    return 60 * 5; // 5分
  }
  // 現在のランク/MMR、マッチ一覧、MMR履歴: 変化しうるので短め
  if (
    /^\/valorant\/v1\/mmr\//.test(pathname) ||
    /^\/valorant\/v2\/mmr\//.test(pathname) ||
    /^\/valorant\/v1\/profile\//.test(pathname) ||
    /^\/valorant\/v4\/matches\//.test(pathname) ||
    /^\/valorant\/v1\/by-puuid\/mmr-history\//.test(pathname)
  ) {
    return VOLATILE_TTL_SECONDS;
  }
  return 0;
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
function buildCacheKey(url) {
  const normalized = new URLSearchParams(url.searchParams);
  normalized.delete('api_key');
  normalized.sort();
  const query = normalized.toString();
  return `${url.pathname}${query ? `?${query}` : ''}`;
}

// 現行アクトのIDを val-content-v1 から解決する。
// content-v1 のレスポンスは巨大なので、KVには actId だけを保存する。
// アクトはリージョン共通なので content の取得は ap シャード固定でよい
// (content-v1 は 250req/10s と余裕があり、6時間に1回程度しか呼ばれない)。
async function resolveActiveActId(env, ctx, riotKey) {
  if (env.VALORANT_CACHE) {
    try {
      const cached = await env.VALORANT_CACHE.get(RIOT_ACT_CACHE_KEY, 'json');
      if (cached && cached.actId) {
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
function transformRiotLeaderboard(riotJson) {
  const players = Array.isArray(riotJson.players) ? riotJson.players : [];
  return {
    status: 200,
    data: {
      updated_at: new Date().toISOString(),
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
async function fetchRiotLeaderboard(region, size, startIndex, env, ctx, riotKey) {
  let actId = await resolveActiveActId(env, ctx, riotKey);
  if (!actId) return null;

  let response = await requestRiotLeaderboard(region, actId, size, startIndex, riotKey);

  // アクト切替直後はキャッシュ済み actId が失効して 400/404 になるため、
  // キャッシュを破棄して再解決し、1回だけリトライする
  if (response.status === 400 || response.status === 404) {
    if (env.VALORANT_CACHE) {
      await env.VALORANT_CACHE.delete(RIOT_ACT_CACHE_KEY).catch((err) => {
        console.error('KV act cache delete failed:', err);
      });
    }
    actId = await resolveActiveActId(env, ctx, riotKey);
    if (!actId) return null;
    response = await requestRiotLeaderboard(region, actId, size, startIndex, riotKey);
  }

  if (!response.ok) {
    console.error(`Riot ranked-v1 request failed: ${response.status}`);
    return null;
  }
  return transformRiotLeaderboard(await response.json());
}

// Riot 経路が使えない/失敗した場合の HenrikDev v3 フォールバック。
// もともと Henrik v3 形状なので無変換で返す。成功時は同じ KV キーに保存する
// (TTL 経過後に自然と Riot 経路の再試行に戻る)。
async function fetchHenrikLeaderboardFallback(region, size, page, env, ctx, headers, cacheKey) {
  if (!env.HENRIKDEV_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'No upstream API key is configured on the Worker' }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
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

  if (cacheKey && upstreamResponse.ok && env.VALORANT_CACHE) {
    ctx.waitUntil(
      env.VALORANT_CACHE.put(cacheKey, bodyText, { expirationTtl: RIOT_LEADERBOARD_TTL_SECONDS }).catch((err) => {
        console.error('KV cache write failed:', err);
      })
    );
  }

  // 両経路失敗時は Henrik のエラーを status ごと返す
  // (クライアント側の 429 リトライ等の既存ハンドリングをそのまま活かす)
  return new Response(bodyText, {
    status: upstreamResponse.status,
    headers: {
      ...headers,
      'Content-Type': upstreamResponse.headers.get('Content-Type') || 'application/json',
      'X-Cache': 'MISS',
      'X-Leaderboard-Source': 'henrik-fallback',
    },
  });
}

// /riot/* 経路のエントリポイント。受け付けるのは /riot/leaderboard/{region} のみ
// (Riot API 全体を素通しする汎用プロキシにはしない)。
async function handleRiotRequest(url, env, ctx, headers) {
  const match = url.pathname.match(/^\/riot\/leaderboard\/([a-z]+)$/);
  if (!match) {
    return new Response('Not Found', { status: 404, headers });
  }

  const region = match[1];
  if (!RIOT_REGIONS.has(region)) {
    return new Response(
      JSON.stringify({ error: `Unsupported region: ${region}` }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const size = Math.min(Math.max(parseInt(url.searchParams.get('size'), 10) || 100, 1), 200);
  const page = Math.max(parseInt(url.searchParams.get('page'), 10) || 1, 1);
  // Henrik はページ番号、Riot は開始インデックスなのでここで変換する
  const startIndex = (page - 1) * size;

  // クエリの並び順や省略に左右されないよう、正規化した固定形式のキーを使う
  const cacheKey = `/riot/leaderboard/${region}?page=${page}&size=${size}`;
  if (env.VALORANT_CACHE) {
    try {
      const cached = await env.VALORANT_CACHE.get(cacheKey, 'text');
      if (cached !== null) {
        return new Response(cached, {
          status: 200,
          headers: { ...headers, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
        });
      }
    } catch (err) {
      console.error('KV cache read failed:', err);
    }
  }

  // RIOT_API_KEY 未設定でも 500 にせず Henrik へフォールバックする
  // (secret 登録前に Worker だけ先行デプロイしても壊れない)
  if (env.RIOT_API_KEY) {
    try {
      const result = await fetchRiotLeaderboard(region, size, startIndex, env, ctx, env.RIOT_API_KEY);
      if (result) {
        const bodyText = JSON.stringify(result);
        if (env.VALORANT_CACHE) {
          ctx.waitUntil(
            env.VALORANT_CACHE.put(cacheKey, bodyText, { expirationTtl: RIOT_LEADERBOARD_TTL_SECONDS }).catch((err) => {
              console.error('KV cache write failed:', err);
            })
          );
        }
        return new Response(bodyText, {
          status: 200,
          headers: {
            ...headers,
            'Content-Type': 'application/json',
            'X-Cache': 'MISS',
            'X-Leaderboard-Source': 'riot',
          },
        });
      }
    } catch (err) {
      console.error('Riot leaderboard route failed, falling back to Henrik:', err);
    }
  }

  return fetchHenrikLeaderboardFallback(region, size, page, env, ctx, headers, cacheKey);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers });
    }

    const url = new URL(request.url);

    // Riot 公式 API 経路 (/riot/leaderboard/{region} のみ受け付ける)
    if (url.pathname.startsWith('/riot/')) {
      return handleRiotRequest(url, env, ctx, headers);
    }

    // このプロキシが転送してよいのは /valorant/ 配下のみに限定する
    // (任意のURLを転送できる汎用オープンプロキシにしないため)。
    if (!url.pathname.startsWith('/valorant/')) {
      return new Response('Not Found', { status: 404, headers });
    }

    if (!env.HENRIKDEV_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'HENRIKDEV_API_KEY is not configured on the Worker' }),
        { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }

    const ttl = getCacheTtlSeconds(url.pathname);
    const cacheEnabled = ttl > 0 && !!env.VALORANT_CACHE;
    const cacheKey = cacheEnabled ? buildCacheKey(url) : null;

    if (cacheEnabled) {
      const cached = await env.VALORANT_CACHE.get(cacheKey, 'text');
      if (cached !== null) {
        return new Response(cached, {
          status: 200,
          headers: { ...headers, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
        });
      }
    }

    const upstreamUrl = new URL(UPSTREAM_HOST + url.pathname);
    upstreamUrl.search = url.search;
    // クライアントが api_key を付けて送ってきても無視し、Worker側の秘密鍵で必ず上書きする
    upstreamUrl.searchParams.delete('api_key');
    upstreamUrl.searchParams.set('api_key', env.HENRIKDEV_API_KEY);

    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    const bodyText = await upstreamResponse.text();

    // 成功レスポンスのみキャッシュする(エラー/レート制限応答は保存しない)。
    // KV書き込みが失敗しても(例: 無料枠の1,000回/日の上限超過で429)、
    // レスポンス自体は既に返しているので致命的にはならない。
    // ただしキャッシュが効かなくなり実質毎回アップストリームへ流れるため、
    // ログにだけ残して静かに諦める。
    if (cacheEnabled && upstreamResponse.ok) {
      ctx.waitUntil(
        env.VALORANT_CACHE.put(cacheKey, bodyText, { expirationTtl: ttl }).catch((err) => {
          console.error('KV cache write failed:', err);
        })
      );
    }

    return new Response(bodyText, {
      status: upstreamResponse.status,
      headers: {
        ...headers,
        'Content-Type': upstreamResponse.headers.get('Content-Type') || 'application/json',
        'X-Cache': 'MISS',
      },
    });
  },
};
