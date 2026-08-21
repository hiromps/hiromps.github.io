// HenrikDev API プロキシ + キャッシュ (Cloudflare Workers)
//
// 目的:
// 1) ブラウザから HenrikDev API を直接叩くと api_key がソース/通信内容に
//    そのまま露出してしまうため、実キーはこの Worker の secret
//    (env.HENRIKDEV_API_KEY) にのみ保持する。
// 2) 同じ問い合わせを Workers KV でキャッシュし、HenrikDev への実際の
//    リクエスト数を減らす(レート制限に引っかかりにくくする)。
//
// クライアント側は今まで通り `${BASE_URL}/v1/mmr/ap/...` のようなパスで
// 呼び出す。BASE_URL を `https://api.henrikdev.xyz/valorant` から
// この Worker の URL + `/valorant` に差し替えるだけで動く想定。

const ALLOWED_ORIGINS = new Set([
  'https://hiromps.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

const UPSTREAM_HOST = 'https://api.henrikdev.xyz';

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
