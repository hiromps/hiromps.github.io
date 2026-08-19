// ランク名 → ローカル画像ファイル名の共有マッピング (ES Module)
// オーバーレイ(js/overlay/)とトラッカー(valorant-stats-tracker/)の両方から import して使う。
// 注意: HenrikDev API はアンランク時に "Unrated" を返すことがあるため、
//       "Unranked" と "Unrated" の両方を unranked にマッピングしている。
export const RANK_FILES = {
    'Iron 1': 'iron1',
    'Iron 2': 'iron2',
    'Iron 3': 'iron3',
    'Bronze 1': 'bronze1',
    'Bronze 2': 'bronze2',
    'Bronze 3': 'bronze3',
    'Silver 1': 'silver1',
    'Silver 2': 'silver2',
    'Silver 3': 'silver3',
    'Gold 1': 'gold1',
    'Gold 2': 'gold2',
    'Gold 3': 'gold3',
    'Platinum 1': 'platinum1',
    'Platinum 2': 'platinum2',
    'Platinum 3': 'platinum3',
    'Diamond 1': 'diamond1',
    'Diamond 2': 'diamond2',
    'Diamond 3': 'diamond3',
    'Ascendant 1': 'ascendant1',
    'Ascendant 2': 'ascendant2',
    'Ascendant 3': 'ascendant3',
    'Immortal 1': 'immortal1',
    'Immortal 2': 'immortal2',
    'Immortal 3': 'immortal3',
    'Radiant': 'radiant',
    'Unranked': 'unranked',
    'Unrated': 'unranked'
};

// ランク画像のURLを返す。import.meta.url 基準で解決するため、
// 読み込むページの階層(ルート / valorant-stats-tracker/)に依存しない。
export function rankImageUrl(rankName) {
    const file = RANK_FILES[rankName] || 'unranked';
    return new URL('../assets/images/ranks/' + file + '.png', import.meta.url).href;
}
