async function fetchPlayerStats(name, tag) {
    try {
        const response = await fetch(`${config.API_BASE_URL}/mmr/ap/${name}/${tag}?api_key=${config.API_KEY}`);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching player stats:', error);
        return null;
    }
}

async function fetchPlayerProfile(name, tag) {
    try {
        const response = await fetch(`${config.API_BASE_URL}/profile/ap/${name}/${tag}?api_key=${config.API_KEY}`);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching player profile:', error);
        return null;
    }
}

// ランク画像のパスを取得する関数
function getRankImageUrl(rank) {
    const rankMap = {
        'Iron 1': 'アイアン１',
        'Iron 2': 'アイアン２',
        'Iron 3': 'アイアン３',
        'Bronze 1': 'ブロンズ１',
        'Bronze 2': 'ブロンズ２',
        'Bronze 3': 'ブロンズ３',
        'Silver 1': 'シルバー１',
        'Silver 2': 'シルバー２',
        'Silver 3': 'シルバー３',
        'Gold 1': 'ゴールド１',
        'Gold 2': 'ゴールド２',
        'Gold 3': 'ゴールド３',
        'Platinum 1': 'プラチナ１',
        'Platinum 2': 'プラチナ２',
        'Platinum 3': 'プラチナ３',
        'Diamond 1': 'ダイヤ１',
        'Diamond 2': 'ダイヤ２',
        'Diamond 3': 'ダイヤ３',
        'Ascendant 1': 'アセンダント１',
        'Ascendant 2': 'アセンダント２',
        'Ascendant 3': 'アセンダント３',
        'Immortal 1': 'イモータル１',
        'Immortal 2': 'イモータル２',
        'Immortal 3': 'イモータル３',
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