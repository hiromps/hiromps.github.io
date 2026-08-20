// HenrikDev API 呼び出し層 (ES Module)

// APIキーはルートの config.js (classic script) が定義するグローバル RIOT_API_KEY から取得。
// config.js が欠落していてもモジュール全体が落ちないように typeof でガードする
// (空文字なら handleSearch 冒頭の既存チェックが従来どおりエラーメッセージを表示する)。
export const API_KEY = (typeof RIOT_API_KEY !== 'undefined') ? RIOT_API_KEY : '';

// --- CONFIGURATION ---

// --- API CALLS ---
export async function apiFetch(url, isHenrikDev = true, retryCount = 3) {
    let requestUrl = url;
    if (isHenrikDev && API_KEY) {
        // URLに既にクエリパラメータがあるか確認
        requestUrl += (url.includes('?') ? '&' : '?') + `api_key=${API_KEY}`;
    }

    const headers = {};

    for (let attempt = 1; attempt <= retryCount; attempt++) {
        try {
            console.log(`[API] リクエスト送信中 (試行 ${attempt}/${retryCount}): ${requestUrl}`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒タイムアウト

            const response = await fetch(requestUrl, {
                headers: headers,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: "レスポンス解析エラー" }));
                const errorMessageDetail = errorData.errors && errorData.errors[0] && errorData.errors[0].message
                                        ? errorData.errors[0].message
                                        : (errorData.message || `HTTP ${response.status}`);

                if (response.status === 401) {
                    throw new Error(`APIキーが無効か期限切れです。新しいAPIキーを取得してください。詳細: ${errorMessageDetail}`);
                }
                if (response.status === 403) {
                    throw new Error(`アクセスが拒否されました。APIキーの権限を確認してください。詳細: ${errorMessageDetail}`);
                }
                if (response.status === 404) {
                    throw new Error(`プレイヤーが見つかりません。ゲーム名とタグラインを確認してください。詳細: ${errorMessageDetail}`);
                }
                if (response.status === 429) {
                    if (attempt < retryCount) {
                        console.warn(`[API] レート制限検出。${2 ** attempt}秒後にリトライします...`);
                        await new Promise(resolve => setTimeout(resolve, 2000 * (2 ** (attempt - 1))));
                        continue;
                    }
                    throw new Error(`APIのレート制限に達しました。しばらく時間をおいてから再試行してください。詳細: ${errorMessageDetail}`);
                }
                if (response.status >= 500) {
                    if (attempt < retryCount) {
                        console.warn(`[API] サーバーエラー (${response.status})。${2 * attempt}秒後にリトライします...`);
                        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                        continue;
                    }
                    throw new Error(`APIサーバーエラーが発生しました。しばらく時間をおいてから再試行してください。詳細: ${errorMessageDetail}`);
                }
                throw new Error(`API呼び出しエラー: ${response.status} - ${errorMessageDetail}`);
            }

            console.log(`[API] リクエスト成功 (試行 ${attempt}/${retryCount})`);
            return await response.json();

        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn(`[API] タイムアウト (試行 ${attempt}/${retryCount})`);
                if (attempt < retryCount) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    continue;
                }
                throw new Error('APIリクエストがタイムアウトしました。ネットワーク接続を確認してください。');
            }

            if (error.message.includes('fetch')) {
                console.warn(`[API] ネットワークエラー (試行 ${attempt}/${retryCount}): ${error.message}`);
                if (attempt < retryCount) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    continue;
                }
                throw new Error('ネットワークエラーが発生しました。インターネット接続を確認してください。');
            }

            // APIエラー系は即座に投げる（リトライしない）
            if (error.message.includes('APIキー') || error.message.includes('アクセスが拒否') || error.message.includes('プレイヤーが見つかりません')) {
                throw error;
            }

            console.error(`[API] 予期しないエラー (試行 ${attempt}/${retryCount}):`, error);
            if (attempt === retryCount) {
                throw new Error(`データの取得に失敗しました: ${error.message}`);
            }

            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
}

export async function getPuuid(gameName, tagLine) {
    const baseUrl = `https://api.henrikdev.xyz/valorant/v2/account/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    const data = await apiFetch(baseUrl);
    if (!data.status || data.status !== 200 || !data.data || !data.data.puuid || !data.data.region) {
        throw new Error('PUUIDまたはリージョンの取得に失敗しました (HenrikDev API)。レスポンス: ' + JSON.stringify(data));
    }
    return data.data; // PUUIDだけでなく、リージョン情報も含むdata.data全体を返す
}

// HenrikDev API v4/matches は size パラメータの値によらず実際には常に最大10件/リクエストしか
// 返さないことを実APIレスポンスで確認済み(size=30を指定しても10件しか返らない)。
// start(オフセット)によるページネーションは正しく機能するため、これでページ単位に取得する。
//
// 以前は検索1回につき常に3ページ(最大30件)を一気に取得していたが、これだと
// 1回の検索で「マッチID3リクエスト + マッチ詳細最大30リクエスト」という大きなバーストが
// 発生し、レート制限を誘発して(特に直列取得の後半にあたる)一部の試合の取得に失敗する
// ことがあった。失敗した試合はそのまま欠落するため、たとえ最新の試合が先頭(=取得順の
// 早い位置)にあっても、後続のリクエストで消費したレート制限の影響で最新分自体が
// 巻き込まれて欠落することがあり、「直近の試合が表示されない」不具合の原因になっていた。
// ページ単位(10件ずつ)で必要になった時にだけ取得することで、1回あたりのリクエスト数を
// 抑えて確実性を優先する。ページ送り(Next)が押されたときに main.js から追加ページを要求する。
export const MATCH_LIST_PAGE_SIZE = 10;

// page は1始まり(1 = 最新10件, 2 = 次の10件, ...)。
// 戻り値: { ids: string[], hasMore: boolean }
// hasMore は「ちょうどページサイズ分返ってきた(=まだ続きがある可能性が高い)」かどうかの目安。
export async function getMatchIdsPage(gameName, tagLine, region, page) {
    const start = (page - 1) * MATCH_LIST_PAGE_SIZE;
    const baseUrl = `https://api.henrikdev.xyz/valorant/v4/matches/${region}/pc/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    const urlWithParams = `${baseUrl}?mode=competitive&size=${MATCH_LIST_PAGE_SIZE}&start=${start}`;

    const data = await apiFetch(urlWithParams);
    if (!data.status || data.status !== 200 || !data.data) {
        throw new Error('マッチIDの取得に失敗しました (HenrikDev API)。レスポンス: ' + JSON.stringify(data));
    }

    const ids = data.data.map(match => match.metadata.match_id);
    return { ids, hasMore: ids.length === MATCH_LIST_PAGE_SIZE };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// match-history.html(ルートの js/api.js)と同じ、同時実行なしの単純な直列取得に統一する。
// 一時期は速度改善のため同時実行+バッチ化していたが、レート制限(429)を誘発しやすく、
// 「30件要求したのに5件しか表示されない」といった取得漏れの原因になっていた。
// ローディングスピナーが止まって見える問題の本当の原因は prefers-reduced-motion による
// CSSアニメーション無効化であり(別途修正済み)、並行化はその対策として不要だったため、
// 確実性を優先してシンプルな直列ループに戻す。onProgress による「検索中... (n/合計)」表示は
// 直列化で所要時間が伸びる分、むしろ有用なのでそのまま残す。
//
// レート制限等で失敗した試合は、全件を1周した後に少し待ってから直列でもう一度だけ再試行する。
async function fetchMatchDetail(matchId, region) {
    // v2からv4に変更し、regionをパスパラメータに追加
    const url = `https://api.henrikdev.xyz/valorant/v4/match/${region}/${matchId}`;
    try {
        const data = await apiFetch(url);
        if (!data.status || data.status !== 200 || !data.data) {
            console.warn(`マッチ詳細の取得に失敗 (ID: ${matchId}): `, data);
            return null;
        }
        return data.data;
    } catch (error) {
        console.warn(`マッチ詳細の取得中にエラー (ID: ${matchId}): `, error);
        // エラーモーダルはhandleSearchのcatchでまとめて表示するため、ここでは個別のエラー表示はしない
        return null;
    }
}

export async function getMatchDetails(matchIds, region, onProgress) {
    const resultsById = new Map();

    for (let i = 0; i < matchIds.length; i++) {
        const data = await fetchMatchDetail(matchIds[i], region);
        if (data) {
            resultsById.set(matchIds[i], data);
        }
        if (onProgress) onProgress(i + 1, matchIds.length);
    }

    let failedIds = matchIds.filter(id => !resultsById.has(id));
    if (failedIds.length > 0) {
        console.warn(`${failedIds.length}件のマッチ詳細取得に失敗したため、少し待ってからリトライします: `, failedIds);
        await sleep(2000); // レート制限が回復する時間を少し空ける
        for (const id of failedIds) {
            const data = await fetchMatchDetail(id, region);
            if (data) {
                resultsById.set(id, data);
            }
        }
        failedIds = matchIds.filter(id => !resultsById.has(id));
        if (failedIds.length > 0) {
            console.warn(`リトライ後も${failedIds.length}件のマッチ詳細を取得できませんでした: `, failedIds);
        }
    }

    // matchIds の順序 (= 最新順) を保って返す
    const matchDetailsArray = matchIds.map(id => resultsById.get(id)).filter(Boolean);

    if (matchDetailsArray.length === 0 && matchIds.length > 0) {
         throw new Error('すべてのマッチ詳細データの取得に失敗しました。');
    }
    return matchDetailsArray;
}

// MMRデータ(現在のランク)の取得。ここが失敗すると「ランク情報なし(Unranked)」に
// フォールバックしてしまい、実際はランクを持つプレイヤーでも表示できなくなる。
// apiFetch は 429/5xx/タイムアウト/ネットワークエラーを内部でリトライするが、
// HTTP自体は200でもレスポンス本文が不完全な「ソフト失敗」はリトライしないため、
// ここで追加のリトライを行い、表示の信頼性を上げる。
//
// 全リトライ失敗時は null を返さず例外を投げる(呼び出し元の main.js が
// Promise.allSettled で拾い、失敗理由がレート制限かどうかを見て「ランク情報なし」と
// 「一時的に取得できなかった」を UI 上で区別するため)。実際に共有APIキーが
// レート制限(429)にかかっている状態で null を返してしまうと、ランクを持つ
// プレイヤーでも "ランク情報なし" という誤った表示になってしまうことを確認済み。
export async function getMmrData(region, gameName, tagLine, retryCount = 3) {
    const baseUrl = `https://api.henrikdev.xyz/valorant/v2/mmr/${region}/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    // PUUIDベースのエンドポイントも利用可能:
    // const baseUrl = `https://api.henrikdev.xyz/valorant/v2/by-puuid/mmr/${region}/${puuid}`;

    let lastError = null;
    for (let attempt = 1; attempt <= retryCount; attempt++) {
        try {
            const data = await apiFetch(baseUrl);
            if (data.status === 200 && data.data) {
                return data.data;
            }
            lastError = new Error(`MMRデータの取得に失敗しました。レスポンス: ` + JSON.stringify(data));
            console.warn(`MMRデータの取得に失敗しました (試行 ${attempt}/${retryCount})。レスポンス: ` + JSON.stringify(data));
        } catch (error) {
            lastError = error;
            console.warn(`MMRデータの取得中にエラー (試行 ${attempt}/${retryCount}): `, error);
        }

        if (attempt < retryCount) {
            await new Promise(resolve => setTimeout(resolve, 800 * attempt));
        }
    }

    throw lastError || new Error('MMRデータの取得に失敗しました。');
}

// getMmrData と同様、全リトライ失敗時は空配列を返さず例外を投げる。
// main.js 側は Promise.allSettled で拾い、showError は呼ばない(本来致命的ではない
// MMR履歴取得の失敗のためだけに毎回エラーモーダルが出ないようにするため、この方針は
// 維持する)。ただし失敗理由(特にレート制限かどうか)は保持して呼び出し元に渡すことで、
// 「本当に取得できるRR履歴が無い」のか「一時的に取得できなかった」のかをUI上で
// 区別できるようにする。以前は失敗時に空配列を返していたため、レート制限中は
// 全試合が一律で "-- RR" 表示になり、あたかも正常にRRデータが存在しないかのように
// 見えてしまっていた。
export async function getMmrHistory(region, puuid, retryCount = 3) {
    const baseUrl = `https://api.henrikdev.xyz/valorant/v1/by-puuid/mmr-history/${region}/${puuid}`;

    let lastError = null;
    for (let attempt = 1; attempt <= retryCount; attempt++) {
        try {
            const data = await apiFetch(baseUrl);
            if (data.status === 200 && data.data) {
                return data.data; // MMR履歴データの配列
            }
            lastError = new Error(`MMR履歴の取得に失敗しました。レスポンス: ` + JSON.stringify(data));
            console.warn(`MMR履歴の取得に失敗しました (試行 ${attempt}/${retryCount})。レスポンス: ` + JSON.stringify(data));
        } catch (error) {
            lastError = error;
            console.warn(`MMR履歴の取得中にエラー (試行 ${attempt}/${retryCount}): `, error);
        }

        if (attempt < retryCount) {
            await new Promise(resolve => setTimeout(resolve, 800 * attempt));
        }
    }

    throw lastError || new Error('MMR履歴の取得に失敗しました。');
}
