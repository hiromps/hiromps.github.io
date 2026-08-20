// 描画層 (ES Module)
import { RANK_FILES, rankImageUrl } from '../../shared/ranks.js';
import { setChartData, updateStatsChart } from './chart.js';

// --- DOM ELEMENTS ---
const searchButton = document.getElementById('searchButton');
const searchIcon = document.getElementById('searchIcon');
const loadingIcon = document.getElementById('loadingIcon');
const buttonText = document.getElementById('buttonText');
const searchProgress = document.getElementById('searchProgress');
const errorModal = document.getElementById('errorModal');
const errorMessage = document.getElementById('errorMessage');
const closeModalButton = document.getElementById('closeModalButton');
const matchHistoryBody = document.getElementById('matchHistoryBody');
const matchHistoryMobile = document.getElementById('matchHistoryMobile');
const matchHistoryLoadMoreStatus = document.getElementById('matchHistoryLoadMoreStatus');
const matchHistoryLoadMoreSpinner = document.getElementById('matchHistoryLoadMoreSpinner');
const matchHistoryLoadMoreText = document.getElementById('matchHistoryLoadMoreText');

closeModalButton.addEventListener('click', () => {
    errorModal.classList.add('hidden');
});

// --- 試合一覧の無限スクロール ---
// 集計(Tracker Score・平均統計・ACS推移グラフ)は「その時点までに取得済みの試合」を
// 対象に再計算する(読み進めるほど対象試合が増えて動的に変化する)。
// 一覧テーブル/カードはページ送りせず、取得済みの試合を下に積み増していく形で表示する。
let loadedMatches = []; // 加工済み(matchRankPoints を含む)の、取得済み全試合
let renderedCount = 0; // 一覧に既に描画済みの件数(この件数分は再描画しない)

// 一覧の下端が画面内に入ったときに、main.js へ追加取得を依頼するコールバック。
// main.js が setPaginationDataSource() で注入する。取得に成功すると main.js 側から
// updateMatchHistoryData() が呼ばれ、その中で loadedMatches が増える。
let onNeedMorePages = null;
let isLoadingMore = false;
// まだ取得できていない試合が残っていそうか(main.js が更新)。false になったら
// 自動読み込みを止める。
let mayHaveMorePages = true;
// 追加読み込み中の「n/合計」進捗(main.js が setLoadMoreProgress() で更新)。
// 検索中と同じ「今どれくらい進んでいるか」を見せることで、スピナーが動いているだけでは
// 分かりにくい「あとどれくらいで終わるか」を明確にする。
let loadMoreProgressDone = 0;
let loadMoreProgressTotal = 0;

export function setPaginationDataSource(callback) {
    onNeedMorePages = callback;
}

export function setMayHaveMorePages(value) {
    mayHaveMorePages = value;
    updateLoadMoreStatus();
}

export function setLoadMoreProgress(done, total) {
    loadMoreProgressDone = done;
    loadMoreProgressTotal = total;
    updateLoadMoreStatus();
}

// 一覧の下端(matchHistoryLoadMoreStatus)が画面内に入るたびに、まだ読み込みできる分が
// あれば自動で追加取得する。読み込み後にまだ同じ要素が画面内に収まっている場合
// (試合数が少なく1画面に収まってしまう場合など)は、intersection の状態変化が
// 起きずスクロールしても次の読み込みが発火しないため、読み込み後に再度可視判定して
// 必要なら連続で読み込む。
const loadMoreObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
        triggerLoadMore();
    }
}, { rootMargin: '200px' });
loadMoreObserver.observe(matchHistoryLoadMoreStatus);

function isLoadMoreStatusInViewport() {
    const rect = matchHistoryLoadMoreStatus.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    return rect.top < viewportHeight + 200 && rect.bottom > 0;
}

async function triggerLoadMore() {
    if (isLoadingMore || !mayHaveMorePages || !onNeedMorePages) return;

    isLoadingMore = true;
    loadMoreProgressDone = 0;
    loadMoreProgressTotal = 0;
    updateLoadMoreStatus();
    try {
        await onNeedMorePages();
    } finally {
        isLoadingMore = false;
        updateLoadMoreStatus();
    }

    if (mayHaveMorePages && isLoadMoreStatusInViewport()) {
        triggerLoadMore();
    }
}

function updateLoadMoreStatus() {
    const total = loadedMatches.length;
    if (total === 0) {
        matchHistoryLoadMoreStatus.classList.add('hidden');
        matchHistoryLoadMoreSpinner.classList.add('hidden');
        matchHistoryLoadMoreText.textContent = '';
        return;
    }

    matchHistoryLoadMoreStatus.classList.remove('hidden');
    if (isLoadingMore) {
        matchHistoryLoadMoreSpinner.classList.remove('hidden');
        matchHistoryLoadMoreText.textContent = loadMoreProgressTotal > 0
            ? `続きの試合を読み込み中... (${loadMoreProgressDone}/${loadMoreProgressTotal})`
            : '続きの試合を読み込み中...';
    } else if (mayHaveMorePages) {
        // スクロールすると自動で続きを読み込む(発火前の待機中は何も表示しない)
        matchHistoryLoadMoreSpinner.classList.add('hidden');
        matchHistoryLoadMoreText.textContent = '';
    } else {
        matchHistoryLoadMoreSpinner.classList.add('hidden');
        matchHistoryLoadMoreText.textContent = `全${total}件を表示しました`;
    }
}

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

// 試合ごとに MMR履歴(RR増減・確定ランク)をマージする(ページが変わるたびに
// mmrHistory.find() を re-run しなくて済むよう、データが更新されるたびに1回だけ計算する)。
// mmrFetchFailedByRateLimit が true の場合、mmrHistory 自体が(レート制限により)
// 取得できていない状態なので、「本当にRR変動データが存在しない」ことを示す "-- RR" ではなく
// 「取得できなかった」ことが分かる表示にする(実データが取得できていないのに
// "-- RR" と出すと、あたかも正常に取得した結果RRデータが無いかのように見えてしまうため)。
function mergeMmrIntoMatches(processedMatchHistory, mmrHistory, mmrFetchFailedByRateLimit) {
    return processedMatchHistory.map(match => {
        let matchRankPoints = mmrFetchFailedByRateLimit ? 'RR取得失敗(再検索してください)' : "-- RR"; // デフォルト
        let rankName = match.rankName;
        let rankIcon = match.rankIcon;
        const historyEntry = mmrHistory.find(h => h.match_id === match.matchId);

        if (historyEntry) {
            const rrChange = historyEntry.mmr_change_to_last_game;
            const currentRRInTier = historyEntry.ranking_in_tier;
            const sign = rrChange >= 0 ? '+' : '';
            matchRankPoints = `${sign}${rrChange} RR (${currentRRInTier} RR)`;

            if (historyEntry.currenttier_patched) {
                rankName = historyEntry.currenttier_patched;
                rankIcon = RANK_FILES[rankName] ? rankImageUrl(rankName) : 'https://placehold.co/48x48/1f2937/7f1d1d?text=R';
            }
        }

        return { ...match, rankName, rankIcon, matchRankPoints };
    });
}

// 一覧の末尾に、まだ描画していない分(renderedCount 以降)だけを追加描画する。
// 既存の行には触れないので、スクロール位置や画像の再読み込みが発生しない。
function appendNewMatchRows() {
    const newMatches = loadedMatches.slice(renderedCount);
    if (newMatches.length === 0) return;

    const desktopFragment = document.createDocumentFragment();
    const mobileFragment = document.createDocumentFragment();
    newMatches.forEach(match => {
        desktopFragment.appendChild(buildMatchRow(match));
        mobileFragment.appendChild(buildMatchCard(match));
    });
    matchHistoryBody.appendChild(desktopFragment);
    matchHistoryMobile.appendChild(mobileFragment);
    renderedCount = loadedMatches.length;
}

// 新しい検索結果を表示する前に、一覧をまっさらな状態に戻す
// (対象シーズン切り替え時など、既存の行を残したままにできない場合に使う)
function resetMatchHistoryList() {
    matchHistoryBody.innerHTML = '';
    matchHistoryMobile.innerHTML = '';
    renderedCount = 0;
}

// 取得済みの試合が増える(自動読み込みで追加取得される)たびに呼び出す。
// 集計(Tracker Score・平均統計・ACS推移グラフ)は取得済みの全試合を対象に再計算し、
// 一覧テーブル/カードは新しく増えた分だけを下に追加描画する。
export function updateMatchHistoryData(processedMatchHistory, mmrHistory, mmrFetchFailedByRateLimit) {
    renderPlayerOverallStats(processedMatchHistory);
    setChartData(processedMatchHistory);
    loadedMatches = mergeMmrIntoMatches(processedMatchHistory, mmrHistory, mmrFetchFailedByRateLimit);
    updateStatsChart();
    appendNewMatchRows();
    updateLoadMoreStatus();
}

export function renderResults(processedMatchHistory, name, tag, accountData, mmrData, mmrHistory, mmrFetchFailedByRateLimit) {
    // Player Info
    document.getElementById('playerName').textContent = name;
    document.getElementById('playerTag').textContent = `#${tag}`;

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
        if (mmrFetchFailedByRateLimit) {
            // 本当に未ランクなのではなく、APIのレート制限で一時的に取得できなかっただけの
            // 可能性が高いケース(例: heybro#nidne は実際は Gold 2 だが、レート制限中は
            // "ランク情報なし" と誤表示されていた)。誤解を避けるため文言を分ける。
            rankTextWrap.appendChild(el('span', 'text-lg font-bold text-yellow-400', '取得に失敗しました'));
            rankTextWrap.appendChild(el('span', 'text-xs text-gray-400 mt-1', 'APIのレート制限のため一時的にランク情報を取得できませんでした。少し時間を置いて再検索してください。'));
        } else {
            rankTextWrap.appendChild(el('span', 'text-xl font-bold', 'ランク情報なし'));
            rankTextWrap.appendChild(el('span', 'text-lg text-gray-400', '-- RR'));
        }
        rankWrap.appendChild(rankTextWrap);
        playerRankSection.appendChild(rankWrap);
    }

    // 新しい検索結果なので一覧をまっさらにしてから描画する
    resetMatchHistoryList();

    // Tracker Score・平均統計・ACS推移グラフ・一覧を更新
    // (この時点で取得できている試合が対象。追加読み込みのたびに再度呼ばれ、動的に再計算される)
    updateMatchHistoryData(processedMatchHistory, mmrHistory, mmrFetchFailedByRateLimit);
}

// デスクトップ用テーブル行を1件分作る
function buildMatchRow(match) {
    const row = el('tr', 'hover:bg-gray-700/50 transition-colors');
    row.appendChild(el('td', 'p-4 text-gray-300 whitespace-nowrap', match.matchDate));
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
    rankCellText.appendChild(el('span', 'text-gray-400', match.matchRankPoints));
    rankCellWrap.appendChild(rankCellText);
    rankCell.appendChild(rankCellWrap);
    row.appendChild(rankCell);

    row.appendChild(el('td', `p-4 font-bold ${match.resultColor}`, `${match.result} (${match.score})`));
    row.appendChild(el('td', 'p-4', match.kda));
    row.appendChild(el('td', 'p-4', match.kd));
    row.appendChild(el('td', 'p-4', `${match.hs}%`));
    row.appendChild(el('td', 'p-4 font-bold text-red-400', `${match.acs}`));
    return row;
}

// モバイル用カードを1件分作る
function buildMatchCard(match) {
    const card = el('div', 'match-card p-4 rounded-xl shadow-lg');

    const cardHeader = el('div', 'flex items-center justify-between mb-3');
    const cardAgentWrap = el('div', 'flex items-center gap-3');
    cardAgentWrap.appendChild(createImg(match.agentIcon, match.agentName, 'w-10 h-10 rounded-full object-contain', 'https://placehold.co/32x32/1f2937/7f1d1d?text=?'));
    const cardAgentText = el('div');
    cardAgentText.appendChild(el('div', 'font-bold text-sm', match.agentName));
    cardAgentText.appendChild(el('div', 'text-gray-400 text-xs', match.map));
    cardAgentText.appendChild(el('div', 'text-gray-500 text-xs', match.matchDate));
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
    cardRankText.appendChild(el('div', 'text-gray-400', match.matchRankPoints));
    cardRankWrap.appendChild(cardRankText);
    cardFooter.appendChild(cardRankWrap);
    card.appendChild(cardFooter);

    return card;
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
        searchProgress.textContent = '';
        searchProgress.classList.add('hidden');
    } else {
        searchButton.disabled = false;
        searchIcon.classList.remove('hidden');
        loadingIcon.classList.add('hidden');
        buttonText.textContent = '検索';
        searchProgress.textContent = '';
        searchProgress.classList.add('hidden');
    }
}

// マッチ詳細取得の進捗表示。「検索中...」のまま変化がないと止まって見えるため、
// 件数を継続的に更新して動いていることが分かるようにする。
// ボタン自体のテキストを変えると幅が伸び縮みしてレイアウトが崩れるため、
// ボタンの外側にある独立した要素(searchProgress)に表示する。
export function setLoadingProgress(done, total) {
    searchProgress.textContent = `マッチ詳細を取得中... (${done}/${total})`;
    searchProgress.classList.remove('hidden');
}

export function showError(message) {
    // 改行文字を<br>タグに変換して表示
    const formattedMessage = message.replace(/\n/g, '<br>');
    errorMessage.innerHTML = formattedMessage;
    errorModal.classList.remove('hidden');

    // デバッグ用：エラーメッセージもコンソールに出力
    console.error('[エラー表示]', message);
}
