// 描画層 (ES Module)
import { RANK_FILES, rankImageUrl } from '../../shared/ranks.js';
import { setChartData, updateStatsChart } from './chart.js';

// --- DOM ELEMENTS ---
const searchButton = document.getElementById('searchButton');
const searchIcon = document.getElementById('searchIcon');
const loadingIcon = document.getElementById('loadingIcon');
const buttonText = document.getElementById('buttonText');
const errorModal = document.getElementById('errorModal');
const errorMessage = document.getElementById('errorMessage');
const closeModalButton = document.getElementById('closeModalButton');

closeModalButton.addEventListener('click', () => {
    errorModal.classList.add('hidden');
});

// --- RENDERING ---
// createElement ヘルパー: className と textContent を同時指定(API由来文字列は必ず textContent で挿入する)
function el(tag, className, textContent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent !== undefined) node.textContent = textContent;
    return node;
}

// 画像読み込み失敗時のフォールバック({once:true} で旧 this.onerror=null 相当の無限ループ防止)
function createImg(src, alt, className, fallbackUrl) {
    const img = el('img', className);
    img.alt = alt;
    img.addEventListener('error', function () { img.src = fallbackUrl; }, { once: true });
    img.src = src;
    return img;
}

export function renderResults(processedMatchHistory, name, tag, accountData, mmrData, mmrHistory) {
    // Player Info
    document.getElementById('playerName').textContent = name;
    document.getElementById('playerTag').textContent = `#${tag}`;

    setChartData(processedMatchHistory);

    const playerRankSection = document.getElementById('playerRankSection');
    playerRankSection.innerHTML = ''; // 初期化

    // mmrData と mmrData.current_data の存在をチェックし、さらに currenttierpatched もチェック
    if (playerRankSection && mmrData && mmrData.current_data && mmrData.current_data.currenttierpatched) {
        const currentRankName = mmrData.current_data.currenttierpatched;
        const currentRR = mmrData.current_data.ranking_in_tier || 0;
        const mmrChange = mmrData.current_data.mmr_change_to_last_game;
        let rankIconFromMmr = 'https://placehold.co/80x80/1f2937/7f1d1d?text=R'; // デフォルト

        if (mmrData.current_data.images && mmrData.current_data.images.large) {
            rankIconFromMmr = mmrData.current_data.images.large;
        } else {
             // images.largeがない場合でも、RANK_FILES を使ってローカルアセットを参照する試みは残す
             if (RANK_FILES[currentRankName]) {
                 rankIconFromMmr = rankImageUrl(currentRankName);
             }
        }

        const rankWrap = el('div', 'flex flex-col items-center justify-center mt-1');
        rankWrap.appendChild(createImg(rankIconFromMmr, currentRankName, 'w-20 h-20 object-contain mb-2', 'https://placehold.co/80x80/1f2937/7f1d1d?text=R'));

        const rankTextWrap = el('div', 'flex flex-col items-center text-center');
        rankTextWrap.appendChild(el('span', 'text-xl font-bold', currentRankName));
        rankTextWrap.appendChild(el('span', 'text-2xl text-red-400 font-bold', `${currentRR} RR`));
        if (mmrChange !== undefined && mmrChange !== null) {
            const sign = mmrChange >= 0 ? '+' : '';
            rankTextWrap.appendChild(el('span', `text-sm ${mmrChange >= 0 ? 'text-green-400' : 'text-red-400'} font-semibold`, `前回のマッチ: ${sign}${mmrChange} RR`));
        }
        rankWrap.appendChild(rankTextWrap);
        playerRankSection.appendChild(rankWrap);
    } else if (playerRankSection) { // mmrDataがないか、ランク情報がない場合
        const rankWrap = el('div', 'flex flex-col items-center justify-center mt-1');
        const placeholderImg = el('img', 'w-20 h-20 object-contain mb-2');
        placeholderImg.alt = 'Unranked';
        placeholderImg.src = 'https://placehold.co/80x80/1f2937/7f1d1d?text=R';
        rankWrap.appendChild(placeholderImg);

        const rankTextWrap = el('div', 'flex flex-col items-center text-center');
        rankTextWrap.appendChild(el('span', 'text-xl font-bold', 'ランク情報なし'));
        rankTextWrap.appendChild(el('span', 'text-lg text-gray-400', '-- RR'));
        rankWrap.appendChild(rankTextWrap);
        playerRankSection.appendChild(rankWrap);
    }

    // Calculate and render Tracker Score (これは processedMatchHistory を使う)
    renderPlayerOverallStats(processedMatchHistory);

    // Render Match History (これも processedMatchHistory を使う)
    // 行/カードは DocumentFragment に貯めてループ後に一括 append する(ループ内 innerHTML += の O(n²) 回避)
    const matchHistoryBody = document.getElementById('matchHistoryBody');
    const matchHistoryMobile = document.getElementById('matchHistoryMobile');
    matchHistoryBody.innerHTML = '';
    matchHistoryMobile.innerHTML = '';
    const desktopFragment = document.createDocumentFragment();
    const mobileFragment = document.createDocumentFragment();

    processedMatchHistory.forEach(match => {
        let matchRankPoints = "-- RR"; // デフォルト
        const historyEntry = mmrHistory.find(h => h.match_id === match.matchId);

        if (historyEntry) {
            const rrChange = historyEntry.mmr_change_to_last_game;
            const currentRRInTier = historyEntry.ranking_in_tier; // 名前を明確化
            const sign = rrChange >= 0 ? '+' : '';
            matchRankPoints = `${sign}${rrChange} RR (${currentRRInTier} RR)`;

            // MMR履歴からランク名とアイコンを更新 (もしあれば)
            if (historyEntry.currenttier_patched) {
                match.rankName = historyEntry.currenttier_patched;
                if (RANK_FILES[match.rankName]) {
                    match.rankIcon = rankImageUrl(match.rankName);
                } else {
                     match.rankIcon = 'https://placehold.co/48x48/1f2937/7f1d1d?text=R';
                }
            }
        }

        // デスクトップ用テーブル行
        const row = el('tr', 'hover:bg-gray-700/50 transition-colors');
        row.appendChild(el('td', 'p-4 font-semibold', match.map));

        const agentCell = el('td', 'p-4');
        const agentWrap = el('div', 'flex items-center gap-3');
        agentWrap.appendChild(createImg(match.agentIcon, match.agentName, 'w-8 h-8 rounded-full object-contain', 'https://placehold.co/32x32/1f2937/7f1d1d?text=?'));
        agentWrap.appendChild(el('span', '', match.agentName));
        agentCell.appendChild(agentWrap);
        row.appendChild(agentCell);

        const rankCell = el('td', 'p-2');
        const rankCellWrap = el('div', 'flex items-center');
        rankCellWrap.appendChild(createImg(match.rankIcon, match.rankName, 'w-16 h-16 object-contain', 'https://placehold.co/64x64/1f2937/7f1d1d?text=R'));
        const rankCellText = el('div', 'flex flex-col ml-1 text-xs');
        rankCellText.appendChild(el('span', '', match.rankName));
        rankCellText.appendChild(el('span', 'text-gray-400', matchRankPoints));
        rankCellWrap.appendChild(rankCellText);
        rankCell.appendChild(rankCellWrap);
        row.appendChild(rankCell);

        row.appendChild(el('td', `p-4 font-bold ${match.resultColor}`, `${match.result} (${match.score})`));
        row.appendChild(el('td', 'p-4', match.kda));
        row.appendChild(el('td', 'p-4', match.kd));
        row.appendChild(el('td', 'p-4', `${match.hs}%`));
        row.appendChild(el('td', 'p-4 font-bold text-red-400', `${match.acs}`));
        desktopFragment.appendChild(row);

        // モバイル用カード
        const card = el('div', 'match-card p-4 rounded-xl shadow-lg');

        const cardHeader = el('div', 'flex items-center justify-between mb-3');
        const cardAgentWrap = el('div', 'flex items-center gap-3');
        cardAgentWrap.appendChild(createImg(match.agentIcon, match.agentName, 'w-10 h-10 rounded-full object-contain', 'https://placehold.co/32x32/1f2937/7f1d1d?text=?'));
        const cardAgentText = el('div');
        cardAgentText.appendChild(el('div', 'font-bold text-sm', match.agentName));
        cardAgentText.appendChild(el('div', 'text-gray-400 text-xs', match.map));
        cardAgentWrap.appendChild(cardAgentText);
        cardHeader.appendChild(cardAgentWrap);
        const cardResult = el('div', 'text-right');
        cardResult.appendChild(el('div', `font-bold ${match.resultColor} text-sm`, match.result));
        cardResult.appendChild(el('div', 'text-gray-400 text-xs', match.score));
        cardHeader.appendChild(cardResult);
        card.appendChild(cardHeader);

        const statsGrid = el('div', 'grid grid-cols-2 gap-3 mb-3');
        [
            { label: 'KDA', value: match.kda, valueClass: 'font-semibold text-sm' },
            { label: 'K/D', value: match.kd, valueClass: 'font-semibold text-sm' },
            { label: 'HS%', value: `${match.hs}%`, valueClass: 'font-semibold text-sm' },
            { label: 'ACS', value: `${match.acs}`, valueClass: 'font-semibold text-sm text-red-400' }
        ].forEach(stat => {
            const statBox = el('div', 'bg-gray-700/50 rounded-lg p-2 text-center');
            statBox.appendChild(el('div', 'text-xs text-gray-400 mb-1', stat.label));
            statBox.appendChild(el('div', stat.valueClass, stat.value));
            statsGrid.appendChild(statBox);
        });
        card.appendChild(statsGrid);

        const cardFooter = el('div', 'flex items-center justify-between pt-2 border-t border-gray-700/50');
        const cardRankWrap = el('div', 'flex items-center gap-2');
        cardRankWrap.appendChild(createImg(match.rankIcon, match.rankName, 'w-8 h-8 object-contain', 'https://placehold.co/32x32/1f2937/7f1d1d?text=R'));
        const cardRankText = el('div', 'text-xs');
        cardRankText.appendChild(el('div', 'font-medium', match.rankName));
        cardRankText.appendChild(el('div', 'text-gray-400', matchRankPoints));
        cardRankWrap.appendChild(cardRankText);
        cardFooter.appendChild(cardRankWrap);
        card.appendChild(cardFooter);

        mobileFragment.appendChild(card);
    });

    matchHistoryBody.appendChild(desktopFragment);
    matchHistoryMobile.appendChild(mobileFragment);

    // Render ACS Chart (これも processedMatchHistory を使う)
    updateStatsChart();
}

function renderPlayerOverallStats(playerData) {
    const trackerScoreEl = document.getElementById('trackerScore');
    const trackerTierEl = document.getElementById('trackerTier');
    const statAvgAcsEl = document.getElementById('statAvgAcs');
    const statAvgKdEl = document.getElementById('statAvgKd');
    const statWinRateEl = document.getElementById('statWinRate');
    const statAvgDdDeltaEl = document.getElementById('statAvgDdDelta');

    // --- ティアとそれに対応するスタイルクラスの定義 (関数の早い段階で定義) ---
    const tierStylesDefinition = {
        s: { bgClass: 'tier-s', labelTextClass: 'text-blue-100', valueTextClass: 'text-white' },
        a: { bgClass: 'tier-a', labelTextClass: 'text-green-100', valueTextClass: 'text-white' },
        b: { bgClass: 'tier-b', labelTextClass: 'text-yellow-700', valueTextClass: 'text-gray-800' },
        c: { bgClass: 'tier-c', labelTextClass: 'text-gray-200', valueTextClass: 'text-white' },
        d: { bgClass: 'tier-d', labelTextClass: 'text-red-100', valueTextClass: 'text-white' },
        default: { bgClass: 'bg-gray-700', labelTextClass: 'text-gray-300', valueTextClass: 'text-white' }
    };

    // スタイルクラスのリスト (これも早期に定義)
    const allBgStyleClasses = Object.values(tierStylesDefinition).map(s => s.bgClass).filter(Boolean);
    const allLabelTextStyleClasses = Object.values(tierStylesDefinition).map(s => s.labelTextClass).filter(Boolean);
    const allValueTextStyleClasses = Object.values(tierStylesDefinition).map(s => s.valueTextClass).filter(Boolean);

    // playerData が空の場合の早期リターンとスタイル設定
    if (playerData.length === 0) {
        trackerScoreEl.textContent = "---";
        trackerTierEl.textContent = "--";
        trackerTierEl.className = 'mt-3 text-2xl font-bold px-8 py-2 rounded-full shadow-md bg-gray-700'; // Default tier display

        const defaultStyle = tierStylesDefinition.default;
        const elementsToReset = {
            avgAcs: { card: document.getElementById('statCardAvgAcs'), valueEl: statAvgAcsEl, tierEl: document.getElementById('statTierAvgAcs') },
            avgKd: { card: document.getElementById('statCardAvgKd'), valueEl: statAvgKdEl, tierEl: document.getElementById('statTierAvgKd') },
            winRate: { card: document.getElementById('statCardWinRate'), valueEl: statWinRateEl, tierEl: document.getElementById('statTierWinRate') },
            avgDdDelta: { card: document.getElementById('statCardAvgDdDelta'), valueEl: statAvgDdDeltaEl, tierEl: document.getElementById('statTierAvgDdDelta') }
        };

        for (const key in elementsToReset) {
            const item = elementsToReset[key];
            if (!item.card || !item.valueEl || !item.tierEl) continue;

            item.card.classList.remove(...allBgStyleClasses);
            item.card.classList.add(defaultStyle.bgClass);

            const labelSpan = item.card.children[0];
            if (labelSpan) {
                labelSpan.classList.remove(...allLabelTextStyleClasses);
                labelSpan.classList.add(defaultStyle.labelTextClass);
            }
            item.valueEl.textContent = "N/A";
            item.valueEl.classList.remove(...allValueTextStyleClasses);
            item.valueEl.classList.add(defaultStyle.valueTextClass);

            item.tierEl.textContent = "--";
            item.tierEl.classList.remove(...allValueTextStyleClasses);
            item.tierEl.classList.add(defaultStyle.valueTextClass);
        }
        return; // 早期リターン
    }

    // --- メインの統計計算と表示ロジック (playerData が空でない場合) ---
    const avgAcs = playerData.reduce((sum, d) => sum + d.acs, 0) / playerData.length;
    const totalKills = playerData.reduce((sum, d) => sum + d.kills, 0);
    const totalDeaths = playerData.reduce((sum, d) => sum + d.deaths, 0);
    const avgKd = totalDeaths === 0 ? totalKills : totalKills / totalDeaths;
    const avgHs = playerData.reduce((sum, d) => sum + parseFloat(d.hs), 0) / playerData.length;

    const wins = playerData.filter(d => d.resultBoolean).length;
    const totalGames = playerData.length;
    const winRate = totalGames > 0 ? (wins / totalGames) * 100 : 0;

    let totalRoundAvgDdDelta = 0;
    let validDdDeltaGamesCount = 0;
    playerData.forEach(d => {
        if (d.roundsPlayed > 0 && typeof d.damageDealt === 'number' && typeof d.damageReceived === 'number') {
            const roundDdDelta = (d.damageDealt - d.damageReceived) / d.roundsPlayed;
            if (!isNaN(roundDdDelta) && isFinite(roundDdDelta)) {
                totalRoundAvgDdDelta += roundDdDelta;
                validDdDeltaGamesCount++;
            }
        }
    });
    const calculatedAvgDdDelta = validDdDeltaGamesCount > 0 ? Math.round(totalRoundAvgDdDelta / validDdDeltaGamesCount) : null;

    // Tracker Score 計算 (これは全体のトラッカースコア用)
    const rawScore = (avgAcs * 0.9) + (avgKd * 40) + (avgHs * 1.2);
    const scalingFactor = 2.25;
    let finalScore = Math.round(rawScore * scalingFactor);
    finalScore = Math.min(finalScore, 999);
    finalScore = Math.max(finalScore, 0);
    trackerScoreEl.textContent = finalScore;

    let overallTier = '';
    let overallTierClass = ''; // Tracker Score 全体のティア表示用クラス名
    if (finalScore >= 800) { overallTier = 'S'; overallTierClass = 'tier-s'; }
    else if (finalScore >= 600) { overallTier = 'A'; overallTierClass = 'tier-a'; }
    else if (finalScore >= 400) { overallTier = 'B'; overallTierClass = 'tier-b'; }
    else if (finalScore >= 200) { overallTier = 'C'; overallTierClass = 'tier-c'; }
    else { overallTier = 'D'; overallTierClass = 'tier-d'; }
    trackerTierEl.textContent = overallTier;
    trackerTierEl.className = 'mt-3 text-2xl font-bold px-8 py-2 rounded-full shadow-md ' + overallTierClass;

    // 各統計項目の要素と値のマッピング
    const statElements = {
        avgAcs:   { card: document.getElementById('statCardAvgAcs'),   valueEl: statAvgAcsEl,   tierEl: document.getElementById('statTierAvgAcs'),   type: 'acs',     val: Math.round(avgAcs) },
        avgKd:    { card: document.getElementById('statCardAvgKd'),    valueEl: statAvgKdEl,    tierEl: document.getElementById('statTierAvgKd'),    type: 'kd',      val: parseFloat(avgKd.toFixed(2)) },
        winRate:  { card: document.getElementById('statCardWinRate'),  valueEl: statWinRateEl,  tierEl: document.getElementById('statTierWinRate'),  type: 'winRate', val: parseFloat(winRate.toFixed(1)) },
        avgDdDelta: { card: document.getElementById('statCardAvgDdDelta'), valueEl: statAvgDdDeltaEl, tierEl: document.getElementById('statTierAvgDdDelta'), type: 'ddDelta', val: calculatedAvgDdDelta }
    };

    // スタイル適用ループ
    for (const key in statElements) {
        const item = statElements[key];
        if (!item.card || !item.valueEl || !item.tierEl) continue;

        const itemTierKey = (item.val === null || typeof item.val === 'undefined') ? 'default' : getTier(item.val, item.type);
        const currentItemStyle = tierStylesDefinition[itemTierKey] || tierStylesDefinition.default;

        const labelSpan = item.card.children[0];

        item.card.classList.remove(...allBgStyleClasses);
        item.card.classList.add(currentItemStyle.bgClass);

        if (labelSpan) {
            labelSpan.classList.remove(...allLabelTextStyleClasses);
            labelSpan.classList.add(currentItemStyle.labelTextClass);
        }

        item.valueEl.classList.remove(...allValueTextStyleClasses);
        item.valueEl.classList.add(currentItemStyle.valueTextClass);

        const tierLetter = (itemTierKey === 'default') ? '--' : itemTierKey.toUpperCase();
        item.tierEl.textContent = tierLetter;
        item.tierEl.classList.remove(...allValueTextStyleClasses);
        item.tierEl.classList.add(currentItemStyle.valueTextClass);
    }

    // 値の表示更新 (statElementsループ内でも良いが、ここでまとめて行う)
    statAvgAcsEl.textContent = Math.round(avgAcs);
    statAvgKdEl.textContent = avgKd.toFixed(2);
    statWinRateEl.textContent = `${winRate.toFixed(1)}% (${wins}/${totalGames})`;
    statAvgDdDeltaEl.textContent = (calculatedAvgDdDelta === null) ? "N/A" : calculatedAvgDdDelta;
}

function getTier(value, type) {
    switch (type) {
        case 'acs':
            if (value >= 220) return 's';
            if (value >= 180) return 'a';
            if (value >= 140) return 'b';
            if (value >= 100) return 'c';
            return 'd';
        case 'kd':
            if (value >= 1.3) return 's';
            if (value >= 1.1) return 'a';
            if (value >= 0.9) return 'b';
            if (value >= 0.7) return 'c';
            return 'd';
        case 'winRate':
            if (value >= 65) return 's';
            if (value >= 55) return 'a';
            if (value >= 45) return 'b';
            if (value >= 35) return 'c';
            return 'd';
        case 'ddDelta':
            if (value >= 20) return 's';
            if (value >= 10) return 'a';
            if (value >= 0) return 'b';
            if (value >= -10) return 'c';
            return 'd';
        default:
            console.warn(`Unknown tier type encountered: ${type}`);
            return 'default'; // Ensure a string is always returned
    }
}

// --- UTILITY FUNCTIONS ---
export function setLoadingState(isLoading) {
    if (isLoading) {
        searchButton.disabled = true;
        searchIcon.classList.add('hidden');
        loadingIcon.classList.remove('hidden');
        buttonText.textContent = '検索中...';
    } else {
        searchButton.disabled = false;
        searchIcon.classList.remove('hidden');
        loadingIcon.classList.add('hidden');
        buttonText.textContent = '検索';
    }
}

export function showError(message) {
    // 改行文字を<br>タグに変換して表示
    const formattedMessage = message.replace(/\n/g, '<br>');
    errorMessage.innerHTML = formattedMessage;
    errorModal.classList.remove('hidden');

    // デバッグ用：エラーメッセージもコンソールに出力
    console.error('[エラー表示]', message);
}
