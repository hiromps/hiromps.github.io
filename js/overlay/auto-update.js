// 自動更新タイマー層 (ES Module)
import { state } from './state.js';
import { updatePlayerInfo } from './render.js';

// 自動更新機能。旧 startAutoUpdate/startOBSAutoUpdate を1関数に統合。
// presence guard → stopAutoUpdate()(clear-first) → 必要なら即時1回実行 → setInterval、の順で実行する。
// opts.immediate を渡すと(旧 startOBSAutoUpdate 相当)開始直後にも1回 updatePlayerInfo を呼ぶ。
export function startAutoUpdate(intervalSeconds = 60, opts) {
    if (!state.currentPlayerName || !state.currentPlayerTag) {
        return;
    }

    // 既に動いているタイマーがあれば止めてから開始する(常に clear-first)
    stopAutoUpdate();

    state.isAutoUpdateEnabled = true;
    console.log(`自動更新を開始しました（${intervalSeconds}秒間隔）`);

    if (opts && opts.immediate) {
        updatePlayerInfo(state.currentPlayerName, state.currentPlayerTag).catch(error => {
            console.error('初回更新中にエラーが発生しました:', error);
        });
    }

    // 定期的にプレイヤー情報を更新
    state.updateInterval = setInterval(() => {
        if (state.currentPlayerName && state.currentPlayerTag) {
            console.log('プレイヤー情報を自動更新中...');
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

export function stopAutoUpdate() {
    state.isAutoUpdateEnabled = false;
    if (state.updateInterval) {
        clearInterval(state.updateInterval);
        state.updateInterval = null;
        console.log('自動更新を停止しました');
    }
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
