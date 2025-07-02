async function fetchPlayerStats(name, tag, retryCount = 3) {
    for (let attempt = 1; attempt <= retryCount; attempt++) {
        try {
            console.log(`[API] fetchPlayerStats リクエスト送信中 (試行 ${attempt}/${retryCount})`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒タイムアウト

            const response = await fetch(`${config.API_BASE_URL}/v1/mmr/ap/${name}/${tag}?api_key=${config.API_KEY}`, {
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                if (response.status === 429 && attempt < retryCount) {
                    const waitTime = 2000 * (2 ** (attempt - 1));
                    console.warn(`[API] レート制限検出。${waitTime}ms後にリトライします...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }
                if (response.status >= 500 && attempt < retryCount) {
                    console.warn(`[API] サーバーエラー (${response.status})。${2 * attempt}秒後にリトライします...`);
                    await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                    continue;
                }
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            console.log(`[API] fetchPlayerStats リクエスト成功 (試行 ${attempt}/${retryCount})`);
            return data;

        } catch (error) {
            if (error.name === 'AbortError' && attempt < retryCount) {
                console.warn(`[API] タイムアウト (試行 ${attempt}/${retryCount})`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                continue;
            }
            
            if (error.message.includes('fetch') && attempt < retryCount) {
                console.warn(`[API] ネットワークエラー (試行 ${attempt}/${retryCount}): ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                continue;
            }
            
            console.error(`[API] fetchPlayerStats エラー (試行 ${attempt}/${retryCount}):`, error);
            if (attempt === retryCount) {
                return null;
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
    return null;
}

async function fetchPlayerProfile(name, tag, retryCount = 3) {
    for (let attempt = 1; attempt <= retryCount; attempt++) {
        try {
            console.log(`[API] fetchPlayerProfile リクエスト送信中 (試行 ${attempt}/${retryCount})`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒タイムアウト

            const response = await fetch(`${config.API_BASE_URL}/v1/profile/ap/${name}/${tag}?api_key=${config.API_KEY}`, {
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                if (response.status === 429 && attempt < retryCount) {
                    const waitTime = 2000 * (2 ** (attempt - 1));
                    console.warn(`[API] レート制限検出。${waitTime}ms後にリトライします...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }
                if (response.status >= 500 && attempt < retryCount) {
                    console.warn(`[API] サーバーエラー (${response.status})。${2 * attempt}秒後にリトライします...`);
                    await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                    continue;
                }
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            console.log(`[API] fetchPlayerProfile リクエスト成功 (試行 ${attempt}/${retryCount})`);
            return data;

        } catch (error) {
            if (error.name === 'AbortError' && attempt < retryCount) {
                console.warn(`[API] タイムアウト (試行 ${attempt}/${retryCount})`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                continue;
            }
            
            if (error.message.includes('fetch') && attempt < retryCount) {
                console.warn(`[API] ネットワークエラー (試行 ${attempt}/${retryCount}): ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                continue;
            }
            
            console.error(`[API] fetchPlayerProfile エラー (試行 ${attempt}/${retryCount}):`, error);
            if (attempt === retryCount) {
                return null;
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
    return null;
}

// ランク画像のパスを取得する関数
function getRankImageUrl(rank) {
    const rankMap = {
        'Iron 1': 'アイアン1',
        'Iron 2': 'アイアン2',
        'Iron 3': 'アイアン3',
        'Bronze 1': 'ブロンズ1',
        'Bronze 2': 'ブロンズ2',
        'Bronze 3': 'ブロンズ3',
        'Silver 1': 'シルバー1',
        'Silver 2': 'シルバー2',
        'Silver 3': 'シルバー3',
        'Gold 1': 'ゴールド1',
        'Gold 2': 'ゴールド2',
        'Gold 3': 'ゴールド3',
        'Platinum 1': 'プラチナ1',
        'Platinum 2': 'プラチナ2',
        'Platinum 3': 'プラチナ3',
        'Diamond 1': 'ダイヤ1',
        'Diamond 2': 'ダイヤ2',
        'Diamond 3': 'ダイヤ3',
        'Ascendant 1': 'アセンダント1',
        'Ascendant 2': 'アセンダント2',
        'Ascendant 3': 'アセンダント3',
        'Immortal 1': 'イモータル1',
        'Immortal 2': 'イモータル2',
        'Immortal 3': 'イモータル3',
        'Radiant': 'レディアント'
    };
    
    const imageName = rankMap[rank] || 'ランクなし';
    return `assets/images/ranks/${imageName}.png`;
}

// ランクからティア番号を取得する関数
function getRankTier(rank) {
    const rankMap = {
        'Iron 1': 0, 'Iron 2': 1, 'Iron 3': 2,
        'Bronze 1': 3, 'Bronze 2': 4, 'Bronze 3': 5,
        'Silver 1': 6, 'Silver 2': 7, 'Silver 3': 8,
        'Gold 1': 9, 'Gold 2': 10, 'Gold 3': 11,
        'Platinum 1': 12, 'Platinum 2': 13, 'Platinum 3': 14,
        'Diamond 1': 15, 'Diamond 2': 16, 'Diamond 3': 17,
        'Ascendant 1': 18, 'Ascendant 2': 19, 'Ascendant 3': 20,
        'Immortal 1': 21, 'Immortal 2': 22, 'Immortal 3': 23,
        'Radiant': 24
    };
    return rankMap[rank] || 0;
}

// エージェント画像のパスを取得する関数
function getAgentImageUrl(agentName) {
    return `assets/images/agents/${agentName.toLowerCase()}.png`;
}

// 共通API関数（戦績トラッカーと同じ仕組み）
async function apiFetch(url, isHenrikDev = true, retryCount = 3) {
    let requestUrl = url;
    if (isHenrikDev && config.API_KEY) {
        // URLに既にクエリパラメータがあるか確認
        requestUrl += (url.includes('?') ? '&' : '?') + `api_key=${config.API_KEY}`;
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

// プレイヤーアカウント情報とPUUIDを取得
async function getPlayerAccount(gameName, tagLine) {
    const baseUrl = `${config.API_BASE_URL}/v2/account/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    const data = await apiFetch(baseUrl); 
    if (!data.status || data.status !== 200 || !data.data || !data.data.puuid || !data.data.region) {
        throw new Error('PUUIDまたはリージョンの取得に失敗しました。レスポンス: ' + JSON.stringify(data));
    }
    return data.data;
}

// マッチIDリストを取得（戦績トラッカーと同じ方式）
async function getMatchIds(gameName, tagLine, region, gameMode = 'competitive', size = 10) {
    const baseUrl = `${config.API_BASE_URL}/v4/matches/${region}/pc/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    const urlWithParams = `${baseUrl}?mode=${gameMode}&size=${size}`;
    const data = await apiFetch(urlWithParams);
    if (!data.status || data.status !== 200 || !data.data) {
        throw new Error('マッチIDの取得に失敗しました。レスポンス: ' + JSON.stringify(data));
    }
    return data.data.map(match => match.metadata.match_id);
}

// マッチ詳細を取得（戦績トラッカーと同じ方式）
async function getMatchDetails(matchIds, region) {
    const matchDetailsArray = [];
    for (const matchId of matchIds) {
        const url = `${config.API_BASE_URL}/v4/match/${region}/${matchId}`;
        try {
            const data = await apiFetch(url);
            if (!data.status || data.status !== 200 || !data.data) {
                console.warn(`マッチ詳細の取得に失敗 (ID: ${matchId}): `, data);
                continue; // エラーがあっても処理を続行し、取得できたマッチのみを処理
            }
            matchDetailsArray.push(data.data);
        } catch (error) {
            console.warn(`マッチ詳細の取得中にエラー (ID: ${matchId}): `, error);
            // エラーがあっても他のマッチの処理を続行
        }
    }
    if (matchDetailsArray.length === 0 && matchIds.length > 0) {
        throw new Error('すべてのマッチ詳細データの取得に失敗しました。');
    }
    return matchDetailsArray;
}

// マッチ履歴を取得する関数（戦績トラッカーの仕組みを使用）
async function fetchMatchHistory(name, tag, region = 'ap', gameMode = 'competitive', size = 10) {
    try {
        console.log(`[API] マッチ履歴取得開始: ${name}#${tag} (地域: ${region})`);
        
        // Step 1: プレイヤーアカウント情報とPUUIDを取得
        const accountData = await getPlayerAccount(name, tag);
        console.log(`[API] アカウント情報取得成功: PUUID=${accountData.puuid}, 地域=${accountData.region}`);
        
        // 戦績トラッカーと同様に、アカウントから取得した地域を使用
        const playerRegion = accountData.region || region;
        
        // Step 2: マッチIDリストを取得
        const matchIds = await getMatchIds(name, tag, playerRegion, gameMode, size);
        console.log(`[API] マッチID取得成功: ${matchIds.length}件のマッチ`);
        
        if (matchIds.length === 0) {
            return {
                status: 200,
                data: [],
                message: 'マッチ履歴が見つかりませんでした。'
            };
        }
        
        // Step 3: マッチ詳細を取得
        const matchDetails = await getMatchDetails(matchIds, playerRegion);
        console.log(`[API] マッチ詳細取得成功: ${matchDetails.length}件の詳細データ`);
        
        return {
            status: 200,
            data: matchDetails,
            accountData: accountData
        };
        
    } catch (error) {
        console.error(`[API] マッチ履歴取得エラー:`, error);
        throw error;
    }
}

// リーダーボードを取得する関数
async function fetchLeaderboard(region = 'ap', retryCount = 3) {
    for (let attempt = 1; attempt <= retryCount; attempt++) {
        try {
            console.log(`[API] fetchLeaderboard リクエスト送信中 (試行 ${attempt}/${retryCount})`);
            console.log(`[API] URL: ${config.API_BASE_URL}/v2/leaderboard/${region}`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            // Henrik-3 APIのv2エンドポイントを使用（リーダーボードはv2）
            const url = config.API_KEY ? 
                `${config.API_BASE_URL}/v2/leaderboard/${region}?api_key=${config.API_KEY}` :
                `${config.API_BASE_URL}/v2/leaderboard/${region}`;

            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'VALORANT-Tracker/1.0'
                }
            });

            clearTimeout(timeoutId);

            console.log(`[API] Response status: ${response.status}`);

            if (!response.ok) {
                if (response.status === 429 && attempt < retryCount) {
                    const waitTime = 2000 * (2 ** (attempt - 1));
                    console.warn(`[API] レート制限検出。${waitTime}ms後にリトライします...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }
                
                const errorText = await response.text();
                console.error(`[API] HTTP ${response.status}: ${errorText}`);
                
                if (response.status === 404) {
                    throw new Error(`地域 "${region}" のリーダーボードが見つかりません`);
                } else if (response.status >= 500) {
                    throw new Error(`サーバーエラー (${response.status})`);
                } else {
                    throw new Error(`API エラー (${response.status}): ${errorText}`);
                }
            }

            const data = await response.json();
            console.log(`[API] fetchLeaderboard リクエスト成功 (試行 ${attempt}/${retryCount})`);
            console.log(`[API] データ構造:`, data);
            return data;

        } catch (error) {
            console.error(`[API] fetchLeaderboard エラー (試行 ${attempt}/${retryCount}):`, error);
            
            if (error.name === 'AbortError') {
                console.warn(`[API] タイムアウト (試行 ${attempt}/${retryCount})`);
            }
            
            if (attempt === retryCount) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
    return null;
}