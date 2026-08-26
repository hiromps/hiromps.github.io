// エントリポイント (ES Module)
import { getPuuid, getMatchIdsPage, getMatchDetails, getMmrData, getMmrHistory } from './api.js';
import { processMatchData } from './process.js';
import { renderResults, updateMatchHistoryData, setPaginationDataSource, setMayHaveMorePages, setLoadMoreProgress, setLoadingState, setLoadingProgress, showError } from './render.js';
import { initChartTypeButtons } from './chart.js';

// module は DOMContentLoaded 後に実行されるため、ここで直接呼んでよい。
// ハンバーガーメニューの初期化は js/hamburger-menu.js(classic script、全ページ共通)が担う。
initChartTypeButtons();
initStatHelpTooltips();

// KDA/K/D/HS%/ACS の「?」ヘルプアイコン: クリックで開閉、他の場所をクリックで閉じる
// (CSS側の :hover / :focus-visible でマウスホバー・キーボード操作にも対応)
function initStatHelpTooltips() {
    document.querySelectorAll('.stat-help').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasActive = btn.classList.contains('active');
            document.querySelectorAll('.stat-help.active').forEach(el => el.classList.remove('active'));
            if (!wasActive) {
                btn.classList.add('active');
            }
        });
    });

    document.addEventListener('click', () => {
        document.querySelectorAll('.stat-help.active').forEach(el => el.classList.remove('active'));
    });
}

// --- DOM ELEMENTS ---
const gameNameInput = document.getElementById('gameNameInput');
const tagLineInput = document.getElementById('tagLineInput');
const searchButton = document.getElementById('searchButton');
const resultsSection = document.getElementById('resultsSection');
const seasonScopeSelect = document.getElementById('seasonScopeSelect');
const matchHistoryTitle = document.getElementById('matchHistoryTitle');

// 現在検索中のプレイヤー情報。無限スクロールでの追加取得や、対象シーズン切り替え時の
// 再加工に使う(検索のたびに新しい検索へ上書きされる)。
let searchContext = null; // { puuid, region, gameName, tagLine, accountData, finalMmrData, finalMmrHistory }

// 取得済みの生マッチ詳細データ。最初は最新10件(1ページ)のみ取得し、
// スクロールで一覧の下端が見えたときにだけ追加ページを取得してここに積み増していく。
let rawMatches = [];
let loadedRawPage = 0;        // 取得済みの生データページ数(1ページ = 最大10件)
let hasMoreRawPages = false;  // APIにまだ生データのページがありそうか(シーズンに関係ない客観的事実)

// 「今シーズンのみ」で絞り込み中、最初の検索結果(最新の試合)から確定するシーズンの
// short コード。以後この検索の間は固定値として扱う。
let currentSeasonShort = null;
// 「今シーズンのみ」で絞り込み中に、それより古いシーズンの試合しか含まないページに
// 到達したか。一度 true になったら、hasMoreRawPages が true のままでも自動読み込みを
// 止める(季節境界を越えた後もAPIには何十ページも古い試合が残っているため、それを
// 全部辿ってしまうと「無限に読み込みが続くのに一覧が増えない」ように見える不具合になる)。
let seasonBoundaryReached = false;
// 生データの取得自体は成功した(またはエラーで失敗した)のに、画面に表示される件数が
// 1件も増えなかった追加読み込みが連続した回数。季節境界の判定に頼らない保険として、
// 一定回数連続で「何も増えない」場合は自動読み込みを強制的に打ち切る。
let consecutiveEmptyLoads = 0;
const MAX_CONSECUTIVE_EMPTY_LOADS = 2;
let lastVisibleMatchCount = 0; // 直近で画面に反映した(フィルタ後の)試合数

// 生データの取得状況とシーズン境界・連続空振り回数を踏まえて、
// 「これ以上自動で追加読み込みを試みてよいか」を判定する。
function computeMayHaveMore() {
    if (!hasMoreRawPages) return false;
    if (consecutiveEmptyLoads >= MAX_CONSECUTIVE_EMPTY_LOADS) return false;
    if (getSeasonScope() === 'current' && seasonBoundaryReached) return false;
    return true;
}

// 無限スクロールで一覧の下端が見えたときに呼ばれる、追加ページ取得コールバック
setPaginationDataSource(loadMoreMatches);

// --- EVENT LISTENERS ---
searchButton.addEventListener('click', handleSearch);
gameNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleSearch();
    }
});
tagLineInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleSearch();
    }
});
seasonScopeSelect.addEventListener('change', () => {
    if (searchContext) {
        reprocessAndRender();
    } else {
        updateMatchHistoryTitle(null);
    }
});

function getSeasonScope() {
    return seasonScopeSelect.value === 'all' ? 'all' : 'current';
}

// api.js の apiFetch / getMmrData / getMmrHistory は、レート制限(429)が原因で
// 全リトライ失敗した場合、メッセージに「レート制限」を含むエラーを投げる。
// この文言で判定し、「本当にデータが無い」のか「一時的に取得できなかった」のかを見分ける。
function isRateLimitError(reason) {
    return !!(reason && typeof reason.message === 'string' && reason.message.includes('レート制限'));
}

// "e11a5" のような short コードを "E11:A5" 表示用に整形する。想定外の形式なら null。
function formatSeasonShort(short) {
    if (!short) return null;
    const matched = /^e(\d+)a(\d+)$/i.exec(short);
    return matched ? `E${matched[1]}:A${matched[2]}` : null;
}

// seasonShort は「実際に表示されている試合が属するシーズン」(processMatchData の結果の
// 先頭要素から取る)。以前は MMR データの by_season の最後のキーを「現行アクト」として
// 使っていたが、これは実際にはまだ試合データが存在しない先のアクトを指すことがあり、
// 直近の実試合(例: 前日プレイ分)まで「今シーズンではない」として除外してしまう不具合が
// あったため廃止した。取得できた試合そのものが持つシーズン情報を信頼する方が確実。
function updateMatchHistoryTitle(seasonShort) {
    if (getSeasonScope() === 'all') {
        matchHistoryTitle.textContent = '全シーズンの戦績 (コンペティティブ)';
        return;
    }
    const label = formatSeasonShort(seasonShort);
    matchHistoryTitle.textContent = label
        ? `今シーズン (${label}) の戦績 (コンペティティブ)`
        : '今シーズンの戦績 (コンペティティブ)';
}

// 取得済みの生データ(rawMatches)を、現在選択中の対象シーズンで再加工して再描画する
// (API へは再アクセスしない)。
function reprocessAndRender() {
    const { puuid, gameName, tagLine, accountData, finalMmrData, finalMmrHistory, mmrFetchFailedByRateLimit } = searchContext;

    const processedMatchHistory = processMatchData(rawMatches, puuid, getSeasonScope());
    updateMatchHistoryTitle(processedMatchHistory[0] ? processedMatchHistory[0].seasonShort : null);

    if (processedMatchHistory.length === 0) {
        resultsSection.classList.add('hidden');
        showError(getSeasonScope() === 'all'
            ? '取得できた試合の中にコンペティティブマッチが見つかりませんでした。'
            : '今シーズンのコンペティティブマッチデータがありません。「全シーズン」に切り替えると表示できる場合があります。');
        return;
    }

    setMayHaveMorePages(computeMayHaveMore());
    renderResults(processedMatchHistory, gameName, tagLine, accountData, finalMmrData, finalMmrHistory, mmrFetchFailedByRateLimit);
    resultsSection.classList.remove('hidden');
}

// 一覧の下端までスクロールして表示できる分がもう手元に無い場合に、次の生データページ
// (最大10件)だけを追加取得し、蓄積したうえで再加工・再描画する。
// 失敗してもエラーモーダルは出さない(致命的ではなく、スクロールし直せば再試行できるため)。
// 取得できた分はそのまま活かし、次ページ以降の存在フラグだけ更新する。
async function loadMoreMatches() {
    if (!searchContext || !computeMayHaveMore()) return;

    const nextPage = loadedRawPage + 1;
    try {
        console.log(`[追加ページ取得] ${nextPage}ページ目のマッチIDを取得中...`);
        const { ids, hasMore } = await getMatchIdsPage(searchContext.gameName, searchContext.tagLine, searchContext.region, nextPage);
        hasMoreRawPages = hasMore;
        if (ids.length === 0) return;

        const newMatchDetails = await getMatchDetails(ids, searchContext.region, setLoadMoreProgress);

        // このページに「今シーズン」の試合が1件も含まれていなければ、それより古い
        // シーズンに入ったとみなす(試合は新しい順に並んでいる前提のため、以後のページを
        // 辿ってもこれ以上「今シーズン」の試合が出てくることはない)。
        if (newMatchDetails.length > 0 && currentSeasonShort) {
            const hasCurrentSeasonMatch = newMatchDetails.some(m =>
                m && m.metadata && m.metadata.season && m.metadata.season.short === currentSeasonShort
            );
            if (!hasCurrentSeasonMatch) {
                seasonBoundaryReached = true;
            }
        }

        rawMatches.push(...newMatchDetails);
        loadedRawPage = nextPage;
        console.log(`[追加ページ取得完了] 累計${rawMatches.length}件の生データ`);

        const processedMatchHistory = processMatchData(rawMatches, searchContext.puuid, getSeasonScope());
        updateMatchHistoryTitle(processedMatchHistory[0] ? processedMatchHistory[0].seasonShort : null);

        consecutiveEmptyLoads = processedMatchHistory.length === lastVisibleMatchCount
            ? consecutiveEmptyLoads + 1
            : 0;
        lastVisibleMatchCount = processedMatchHistory.length;

        updateMatchHistoryData(processedMatchHistory, searchContext.finalMmrHistory, searchContext.mmrFetchFailedByRateLimit);
    } catch (error) {
        console.warn('[追加ページ取得] 失敗しました:', error);
        // 何も表示が増えないまま失敗した場合も、連続空振りとしてカウントする
        // (でないと、常に同じページの取得で例外が起きるバグがあった場合に
        // 「次に進まないまま無限に取得を試み続ける」状態になってしまう)。
        consecutiveEmptyLoads++;
    } finally {
        setMayHaveMorePages(computeMayHaveMore());
    }
}

// --- MAIN FUNCTION ---
async function handleSearch() {
    const gameName = gameNameInput.value.trim();
    const tagLine = tagLineInput.value.trim();
    if (!gameName || !tagLine) {
        showError('ゲーム名とタグラインの両方を入力してください。(#は不要です)');
        return;
    }

    setLoadingState(true);
    resultsSection.classList.add('hidden');
    // 新しい検索を開始するので、前回検索の状態(追加読み込み用に蓄積したデータ)を破棄する
    searchContext = null;
    rawMatches = [];
    loadedRawPage = 0;
    hasMoreRawPages = false;
    currentSeasonShort = null;
    seasonBoundaryReached = false;
    consecutiveEmptyLoads = 0;
    lastVisibleMatchCount = 0;
    setMayHaveMorePages(false);

    try {
        console.log(`[検索開始] プレイヤー: ${gameName}#${tagLine}`);

        // 1. Get Account Data (PUUID and Region) from Riot ID
        console.log('[ステップ1] アカウント情報を取得中...');
        const accountData = await getPuuid(gameName, tagLine);
        if (!accountData || !accountData.puuid || !accountData.region) {
            throw new Error('アカウント情報の取得に失敗しました。プレイヤー名とタグラインを確認してください。');
        }
        const puuid = accountData.puuid;
        const userRegion = accountData.region;
        console.log(`[ステップ1完了] 地域: ${userRegion}, PUUID: ${puuid.substring(0, 8)}...`);

        // 2. 最新のマッチID一覧を取得(1ページ目=最新10件のみ。続きはページ送り時に追加取得する)
        console.log('[ステップ2] マッチID一覧を取得中(最新10件)...');
        const { ids: matchIds, hasMore } = await getMatchIdsPage(gameName, tagLine, userRegion, 1);
        if (matchIds.length === 0) {
            showError('このプレイヤーの直近のコンペティティブマッチが見つかりませんでした。アンレートやカスタムゲームのみプレイしている可能性があります。');
            setLoadingState(false);
            return;
        }
        hasMoreRawPages = hasMore;
        console.log(`[ステップ2完了] ${matchIds.length}件のマッチIDを取得`);

        // 3. Get details for each match
        console.log('[ステップ3] マッチ詳細データを取得中...');
        const matchDetails = await getMatchDetails(matchIds, userRegion, setLoadingProgress);
        console.log(`[ステップ3完了] ${matchDetails.length}件のマッチ詳細を取得`);
        rawMatches = matchDetails;
        loadedRawPage = 1;

        // 4. Get MMR Data (並行実行)
        console.log('[ステップ4] MMRデータを取得中...');
        const [mmrData, mmrHistory] = await Promise.allSettled([
            getMmrData(userRegion, gameName, tagLine),
            getMmrHistory(userRegion, gameName, tagLine)
        ]);

        const finalMmrData = mmrData.status === 'fulfilled' ? mmrData.value : null;
        const finalMmrHistory = mmrHistory.status === 'fulfilled' ? mmrHistory.value : [];

        // 共有APIキーがレート制限(429)にかかっている間は、ランクを持つプレイヤーでも
        // MMR取得が失敗し「ランク情報なし」「-- RR」に見えてしまう(実際に heybro#nidne で
        // 確認済み: 本当は Gold 2 なのに、レート制限中は取得できず未ランクのように見えた)。
        // 「本当にランク/RR履歴が無い」のか「一時的に取得できなかった」のかを画面上で
        // 区別できるよう、失敗理由がレート制限かどうかを保持しておく。
        const mmrFetchFailedByRateLimit =
            (mmrData.status === 'rejected' && isRateLimitError(mmrData.reason)) ||
            (mmrHistory.status === 'rejected' && isRateLimitError(mmrHistory.reason));

        if (mmrData.status === 'rejected') {
            console.warn('[警告] MMRデータの取得に失敗:', mmrData.reason);
        }
        if (mmrHistory.status === 'rejected') {
            console.warn('[警告] MMR履歴の取得に失敗:', mmrHistory.reason);
        }
        console.log('[ステップ4完了] MMRデータ取得完了');

        // 検索コンテキストを保持する(対象シーズン切り替え・追加読み込み時にAPIキーや
        // ゲーム名等を再入力せず使うため)
        searchContext = { puuid, region: userRegion, gameName, tagLine, accountData, finalMmrData, finalMmrHistory, mmrFetchFailedByRateLimit };

        // 5. Process and render data
        console.log('[ステップ5] データ処理中...');
        const processedMatchHistory = processMatchData(rawMatches, puuid, getSeasonScope());
        currentSeasonShort = processedMatchHistory[0] ? processedMatchHistory[0].seasonShort : null;
        lastVisibleMatchCount = processedMatchHistory.length;
        updateMatchHistoryTitle(currentSeasonShort);
        if (processedMatchHistory.length === 0) {
            showError(getSeasonScope() === 'all'
                ? '取得できた試合の中にコンペティティブマッチが見つかりませんでした。'
                : '今シーズンのコンペティティブマッチデータがありません。「全シーズン」に切り替えると表示できる場合があります。');
            setLoadingState(false);
            return;
        }

        setMayHaveMorePages(computeMayHaveMore());
        renderResults(processedMatchHistory, gameName, tagLine, accountData, finalMmrData, finalMmrHistory, mmrFetchFailedByRateLimit);
        console.log(`[検索完了] ${processedMatchHistory.length}件のマッチデータを表示(続きのページ: ${hasMoreRawPages ? 'あり' : 'なし'})`);

        resultsSection.classList.remove('hidden');

    } catch (error) {
        console.error("[検索エラー] 詳細:", error);

        // エラーの種類に応じてより具体的なメッセージを表示
        let userFriendlyMessage = error.message || 'データの取得中に不明なエラーが発生しました。';

        if (error.message.includes('ネットワーク')) {
            userFriendlyMessage += '\n\n• インターネット接続を確認してください\n• VPNを使用している場合は無効にしてみてください';
        } else if (error.message.includes('タイムアウト')) {
            userFriendlyMessage += '\n\n• しばらく時間をおいてから再試行してください\n• ネットワーク速度が遅い可能性があります';
        } else if (error.message.includes('レート制限')) {
            userFriendlyMessage += '\n\n• 短時間に多くのリクエストが送信されました\n• 1-2分待ってから再試行してください';
        } else if (error.message.includes('APIキー')) {
            userFriendlyMessage += '\n\n• config.jsファイルのAPIキーを確認してください\n• 新しいAPIキーが必要な場合があります';
        } else if (error.message.includes('プレイヤーが見つかりません')) {
            userFriendlyMessage += '\n\n• ゲーム名とタグラインの入力内容を確認してください\n• 大文字小文字や特殊文字に注意してください';
        }

        showError(userFriendlyMessage);
    } finally {
        setLoadingState(false);
    }
}
