// 自動更新タイマー層 (ES Module)
// NOTE: startAutoUpdate と startOBSAutoUpdate の統合は C7 で行う。ここでは挙動を変えず移設のみ。
import { state } from './state.js';
import { updatePlayerInfo } from './render.js';

// 自動更新機能（改善版）
export function startAutoUpdate(intervalSeconds = 60) {
    if (state.isAutoUpdateEnabled || !state.currentPlayerName || !state.currentPlayerTag) {
        return;
    }

    state.isAutoUpdateEnabled = true;
    console.log(`自動更新を開始しました（${intervalSeconds}秒間隔）`);

    // 定期的にプレイヤー情報を更新
    state.updateInterval = setInterval(() => {
        if (state.currentPlayerName && state.currentPlayerTag) {
            console.log('プレイヤー情報を自動更新中...');
            updatePlayerInfo(state.currentPlayerName, state.currentPlayerTag).catch(error => {
                console.error('自動更新中にエラーが発生しました:', error);
                // エラーが発生しても自動更新は継続
            });
        }
    }, intervalSeconds * 1000);
}

export function stopAutoUpdate() {
    if (!state.isAutoUpdateEnabled) {
        return;
    }

    state.isAutoUpdateEnabled = false;
    if (state.updateInterval) {
        clearInterval(state.updateInterval);
        state.updateInterval = null;
        console.log('自動更新を停止しました');
    }
}

// OBS専用の自動更新機能（より堅牢）
export function startOBSAutoUpdate(intervalSeconds = 60) {
    // 既に開始されている場合は停止してから再開始
    if (state.updateInterval) {
        clearInterval(state.updateInterval);
    }

    state.isAutoUpdateEnabled = true;
    console.log(`OBS専用自動更新を開始しました（${intervalSeconds}秒間隔）`);

    // 即座に一回実行してから定期実行を開始
    if (state.currentPlayerName && state.currentPlayerTag) {
        updatePlayerInfo(state.currentPlayerName, state.currentPlayerTag).catch(error => {
            console.error('初回更新中にエラーが発生しました:', error);
        });
    }

    // 定期実行
    state.updateInterval = setInterval(() => {
        if (state.currentPlayerName && state.currentPlayerTag) {
            console.log(`[${new Date().toLocaleTimeString()}] プレイヤー情報を自動更新中...`);
            updatePlayerInfo(state.currentPlayerName, state.currentPlayerTag).catch(error => {
                console.error('自動更新中にエラーが発生しました:', error);
                // エラーが発生しても自動更新は継続
            });
        } else {
            console.warn('プレイヤー情報が設定されていません。自動更新を停止します。');
            stopAutoUpdate();
        }
    }, intervalSeconds * 1000);
}

// ページ非表示/表示時の自動更新制御（OBS用に調整）
document.addEventListener('visibilitychange', function () {
    const urlParams = new URLSearchParams(window.location.search);
    const isOBS = urlParams.has('obs');

    // OBSモードの場合は可視性に関係なく自動更新を継続
    if (isOBS) {
        console.log(`可視性変更: ${document.hidden ? '非表示' : '表示'} - OBSモードのため自動更新継続`);
        return;
    }

    if (!state.currentPlayerName || !state.currentPlayerTag) {
        return;
    }

    if (document.hidden) {
        // 通常モードでページが非表示になったら更新を一時停止
        if (state.isAutoUpdateEnabled) {
            stopAutoUpdate();
            console.log('ページが非表示になったため自動更新を一時停止');
        }
    } else {
        // 通常モードでページが表示されたら更新を再開
        if (!state.isAutoUpdateEnabled) {
            const updateFreq = parseInt(urlParams.get('updateInterval')) || 60;
            startAutoUpdate(updateFreq);
            console.log('ページが表示されたため自動更新を再開');
        }
    }
});

// ページ離脱時のクリーンアップ
window.addEventListener('beforeunload', function () {
    stopAutoUpdate();
});
