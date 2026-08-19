// エントリポイント (ES Module)
import { API_KEY, getPuuid, getMatchIds, getMatchDetails, getMmrData, getMmrHistory } from './api.js';
import { processMatchData } from './process.js';
import { renderResults, setLoadingState, showError } from './render.js';
import { initChartTypeButtons } from './chart.js';

// module は DOMContentLoaded 後に実行されるため、ここで直接呼んでよい。
// classic script が担っていた config.js 欠落時の耐性(独立して動く)を保つため、
// ハンバーガーメニューの初期化を最初に行う。
initializeHamburgerMenu();
initChartTypeButtons();

// ハンバーガーメニューの動作（完全統一版）
function initializeHamburgerMenu() {
    const hamburgerMenu = document.getElementById('hamburgerMenu');
    const mobileNav = document.getElementById('mobileNav');

    if (!hamburgerMenu || !mobileNav) {
        console.warn('ハンバーガーメニューまたはモバイルナビが見つかりません');
        return;
    }

    // ハンバーガーメニューのクリックイベント
    hamburgerMenu.addEventListener('click', function (event) {
        event.stopPropagation();
        hamburgerMenu.classList.toggle('active');
        mobileNav.classList.toggle('active');

        // アクセシビリティのためのaria属性を更新
        const isActive = hamburgerMenu.classList.contains('active');
        hamburgerMenu.setAttribute('aria-expanded', isActive);
        mobileNav.setAttribute('aria-hidden', !isActive);
    });

    // モバイルナビのリンクをクリックしたときにメニューを閉じる
    const mobileNavLinks = mobileNav.querySelectorAll('.header-button');
    mobileNavLinks.forEach(link => {
        link.addEventListener('click', () => {
            closeHamburgerMenu();
        });
    });

    // 画面外をクリックしたときにメニューを閉じる
    document.addEventListener('click', function (event) {
        if (!hamburgerMenu.contains(event.target) &&
            !mobileNav.contains(event.target) &&
            mobileNav.classList.contains('active')) {
            closeHamburgerMenu();
        }
    });

    // ESCキーでメニューを閉じる
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && mobileNav.classList.contains('active')) {
            closeHamburgerMenu();
        }
    });

    // ウィンドウリサイズ時にメニューを閉じる（デスクトップビューに戻った場合）
    window.addEventListener('resize', function () {
        if (window.innerWidth > 768 && mobileNav.classList.contains('active')) {
            closeHamburgerMenu();
        }
    });

    // メニューを閉じる共通関数
    function closeHamburgerMenu() {
        hamburgerMenu.classList.remove('active');
        mobileNav.classList.remove('active');
        hamburgerMenu.setAttribute('aria-expanded', false);
        mobileNav.setAttribute('aria-hidden', true);
    }

    // 初期状態のaria属性を設定
    hamburgerMenu.setAttribute('aria-expanded', false);
    hamburgerMenu.setAttribute('aria-label', 'メニューを開く');
    mobileNav.setAttribute('aria-hidden', true);

    console.log('ハンバーガーメニューが正常に初期化されました');
}

// --- DOM ELEMENTS ---
const gameNameInput = document.getElementById('gameNameInput');
const tagLineInput = document.getElementById('tagLineInput');
const searchButton = document.getElementById('searchButton');
const resultsSection = document.getElementById('resultsSection');

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

// --- MAIN FUNCTION ---
async function handleSearch() {
    // APIキーが設定されているかチェックします。
    if (!API_KEY || API_KEY === "YOUR_RIOT_API_KEY_HERE") {
        showError('APIキーが設定されていません。ルートの config.js に有効な Riot API キーを設定してください。');
        return;
    }
    const gameName = gameNameInput.value.trim();
    const tagLine = tagLineInput.value.trim();
    if (!gameName || !tagLine) {
        showError('ゲーム名とタグラインの両方を入力してください。(#は不要です)');
        return;
    }

    setLoadingState(true);
    resultsSection.classList.add('hidden');

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

        // 2. Get recent competitive match IDs
        console.log('[ステップ2] マッチID一覧を取得中...');
        const matchIds = await getMatchIds(gameName, tagLine, userRegion);
        if (matchIds.length === 0) {
            showError('このプレイヤーの直近のコンペティティブマッチが見つかりませんでした。アンレートやカスタムゲームのみプレイしている可能性があります。');
            setLoadingState(false);
            return;
        }
        console.log(`[ステップ2完了] ${matchIds.length}件のマッチIDを取得`);

        // 3. Get details for each match
        console.log('[ステップ3] マッチ詳細データを取得中...');
        const matchDetails = await getMatchDetails(matchIds, userRegion);
        console.log(`[ステップ3完了] ${matchDetails.length}件のマッチ詳細を取得`);

        // 4. Get MMR Data (並行実行)
        console.log('[ステップ4] MMRデータを取得中...');
        const [mmrData, mmrHistory] = await Promise.allSettled([
            getMmrData(userRegion, gameName, tagLine),
            getMmrHistory(userRegion, puuid)
        ]);

        const finalMmrData = mmrData.status === 'fulfilled' ? mmrData.value : null;
        const finalMmrHistory = mmrHistory.status === 'fulfilled' ? mmrHistory.value : [];

        if (mmrData.status === 'rejected') {
            console.warn('[警告] MMRデータの取得に失敗:', mmrData.reason);
        }
        if (mmrHistory.status === 'rejected') {
            console.warn('[警告] MMR履歴の取得に失敗:', mmrHistory.reason);
        }
        console.log('[ステップ4完了] MMRデータ取得完了');

        // 5. Process and render data
        console.log('[ステップ5] データ処理中...');
        const processedMatchHistory = processMatchData(matchDetails, puuid);
        if (processedMatchHistory.length === 0) {
            showError('今シーズンのコンペティティブマッチデータがありません。前のシーズンのデータまたはプレイヤー情報が古い可能性があります。');
            setLoadingState(false);
            return;
        }

        renderResults(processedMatchHistory, gameName, tagLine, accountData, finalMmrData, finalMmrHistory);
        console.log(`[検索完了] ${processedMatchHistory.length}件のマッチデータを表示`);

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
