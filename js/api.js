async function fetchPlayerStats(name, tag, retryCount = 3) {
    for (let attempt = 1; attempt <= retryCount; attempt++) {
        try {
            console.log(`[API] fetchPlayerStats リクエスト送信中 (試行 ${attempt}/${retryCount})`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒タイムアウト

            const response = await fetch(`${config.API_BASE_URL}/mmr/ap/${name}/${tag}?api_key=${config.API_KEY}`, {
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

            const response = await fetch(`${config.API_BASE_URL}/profile/ap/${name}/${tag}?api_key=${config.API_KEY}`, {
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