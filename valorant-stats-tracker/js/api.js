// HenrikDev API 呼び出し層 (ES Module)
import { showError } from './render.js';

// APIキーはルートの config.js (classic script) が定義するグローバル RIOT_API_KEY から取得。
// config.js が欠落していてもモジュール全体が落ちないように typeof でガードする
// (空文字なら handleSearch 冒頭の既存チェックが従来どおりエラーメッセージを表示する)。
export const API_KEY = (typeof RIOT_API_KEY !== 'undefined') ? RIOT_API_KEY : '';

// --- CONFIGURATION ---
export const RAW_MATCH_COUNT_TO_FETCH = 30; // シーズン判定のために取得する試合数 (APIのsize上限も考慮)

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

export async function getMatchIds(gameName, tagLine, region) {
    // platform 'pc' をハードコード。REGION_MATCHの代わりに引数で受け取ったregionを使用
    const baseUrl = `https://api.henrikdev.xyz/valorant/v4/matches/${region}/pc/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    // filter=competitive を mode=competitive に修正
    // size を RAW_MATCH_COUNT_TO_FETCH に変更
    const urlWithParams = `${baseUrl}?mode=competitive&size=${RAW_MATCH_COUNT_TO_FETCH}`;
    const data = await apiFetch(urlWithParams);
    if (!data.status || data.status !== 200 || !data.data) {
        throw new Error('マッチIDの取得に失敗しました (HenrikDev API)。レスポンス: ' + JSON.stringify(data));
    }
    return data.data.map(match => match.metadata.match_id);
}

export async function getMatchDetails(matchIds, region) {
    const matchDetailsArray = [];
    for (const matchId of matchIds) {
        // v2からv4に変更し、regionをパスパラメータに追加
        const url = `https://api.henrikdev.xyz/valorant/v4/match/${region}/${matchId}`;
        try {
            const data = await apiFetch(url);
            if (!data.status || data.status !== 200 || !data.data) {
                console.warn(`マッチ詳細の取得に失敗 (ID: ${matchId}): `, data);
                continue; // エラーがあっても処理を続行し、取得できたマッチのみを処理
            }
            matchDetailsArray.push(data.data);
        } catch (error) {
            console.warn(`マッチ詳細の取得中にエラー (ID: ${matchId}): `, error);
            // エラーモーダルはhandleSearchのcatchでまとめて表示するため、ここでは個別のエラー表示はしない
        }
    }
    if (matchDetailsArray.length === 0 && matchIds.length > 0) {
         throw new Error('すべてのマッチ詳細データの取得に失敗しました。');
    }
    return matchDetailsArray;
}

export async function getMmrData(region, gameName, tagLine) {
    const baseUrl = `https://api.henrikdev.xyz/valorant/v2/mmr/${region}/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    // PUUIDベースのエンドポイントも利用可能:
    // const baseUrl = `https://api.henrikdev.xyz/valorant/v2/by-puuid/mmr/${region}/${puuid}`;
    const data = await apiFetch(baseUrl);
    if (!data.status || data.status !== 200 || !data.data) {
        console.warn('MMRデータの取得に失敗しました (HenrikDev API)。レスポンス: ' + JSON.stringify(data));
        return null; // エラーの場合はnullを返すなどして後続処理で対応
    }
    return data.data;
}

export async function getMmrHistory(region, puuid) {
    const baseUrl = `https://api.henrikdev.xyz/valorant/v1/by-puuid/mmr-history/${region}/${puuid}`;
    try {
        const data = await apiFetch(baseUrl);
        if (!data.status || data.status !== 200 || !data.data) {
            console.warn('MMR履歴の取得に失敗しました (HenrikDev API)。レスポンス: ' + JSON.stringify(data));
            return []; // エラーの場合は空配列を返す
        }
        return data.data; // MMR履歴データの配列
    } catch (error) {
        console.error("Error fetching MMR history:", error);
        showError('MMR履歴データの取得中にエラーが発生しました。詳細はコンソールを確認してください。');
        return []; // エラーの場合は空配列を返す
    }
}
