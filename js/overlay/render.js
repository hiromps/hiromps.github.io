// プレイヤー情報描画層 (ES Module)
// fetchPlayerStats / getRankImageUrl は js/api.js (classic script) が定義するグローバル関数を参照する
// (leaderboard.html / match-history.html も同じ classic script を共有しているため js/api.js は ESM化していない)
import { state } from './state.js';
import { applyClassicSmartAdjustments, handleTextOverflow } from './theme.js';
import { adjustTextSize, adjustOverlayWidth } from './layout.js';

// 「前回のマッチ」ゲージを初期状態(0%・緑・非表示データなし)にリセットする共通処理。
// updatePlayerInfo 内の4箇所(ランクなし/データなし/エラー時、および main.js の OBS+データ無し初期表示)で同一のブロックだった
export function resetGaugeDisplay(labelText) {
    const lastMatchSection = document.getElementById('lastMatchSection');
    const lastMatchText = document.getElementById('lastMatchText');
    const mmrGaugeFill = lastMatchSection.querySelector('.mmr-gauge-fill');

    lastMatchText.textContent = labelText;
    mmrGaugeFill.style.width = '0%';
    mmrGaugeFill.style.backgroundColor = '#4CAF50';
    mmrGaugeFill.style.left = '0';
    mmrGaugeFill.style.right = 'auto';
    lastMatchSection.style.display = 'flex';
}

export async function updatePlayerInfo(name, tag) {
    try {
        console.log(`[${new Date().toLocaleTimeString()}] プレイヤー情報を取得中: ${name}#${tag}`);

        // 堅牢なAPI呼び出しを使用（改善されたfetchPlayerStats関数を使用）
        const stats = await fetchPlayerStats(name, tag);

        console.log('Stats response:', stats);

        if (stats && stats.data) {
            const playerData = stats.data; // stats.data の内容を直接使用
            console.log(`[${new Date().toLocaleTimeString()}] データ取得成功`);

            // ランク情報を更新
            const currentRank = playerData.currenttierpatched;
            const rankingInTier = playerData.ranking_in_tier;
            const mmrChange = playerData.mmr_change_to_last_game; // MMR変動値を取得

            if (currentRank) {
                // APIから取得した画像のURLを使用
                if (playerData.images && playerData.images.large) {
                     document.getElementById('rankIcon').src = playerData.images.large;
                } else {
                     // APIに画像URLがない場合はローカル画像を使用（フォールバック）
                     document.getElementById('rankIcon').src = getRankImageUrl(currentRank);
                }

                document.getElementById('rankText').textContent = currentRank;
                document.getElementById('rrText').textContent = `${rankingInTier || 0}RR`;

                // 直近のマッチ結果（MMR変動値）を更新
                const lastMatchSection = document.getElementById('lastMatchSection');
                const lastMatchText = document.getElementById('lastMatchText');
                const mmrGaugeFill = lastMatchSection.querySelector('.mmr-gauge-fill');

                // 現在のRR値に基づいてゲージを表示
                if (rankingInTier !== undefined && rankingInTier !== null) {
                    // 前回のマッチの結果のみ表示
                    if (mmrChange !== undefined) {
                        const sign = mmrChange >= 0 ? '+' : '';
                        lastMatchText.textContent = `前回のマッチ ${sign}${mmrChange}pts`;
                    } else {
                        lastMatchText.textContent = '前回のマッチ';
                    }

                    // ゲージの幅を計算（RR値 / 100 * 100 = パーセンテージ）
                    const gaugePercentage = Math.min(100, Math.max(0, rankingInTier)); // 0-100の範囲に制限

                    // 常に緑色のゲージ（現在のランクポイントを表すため）
                    mmrGaugeFill.style.width = `${gaugePercentage}%`;
                    mmrGaugeFill.style.backgroundColor = '#4CAF50'; // 緑
                    mmrGaugeFill.style.left = '0';
                    mmrGaugeFill.style.right = 'auto';

                    lastMatchSection.style.display = 'flex'; // ゲージ表示のためflexに変更
                } else {
                    lastMatchSection.style.display = 'none';
                }

                console.log(`[${new Date().toLocaleTimeString()}] ランク情報更新: ${currentRank} ${rankingInTier}RR`);

            } else { // currentRank がない場合 (例: ランクなし)
                document.getElementById('rankIcon').src = 'assets/images/ranks/unranked.png';
                document.getElementById('rankText').textContent = 'ランクなし';
                document.getElementById('rrText').textContent = '0RR';
                resetGaugeDisplay('前回のマッチ');
                console.log(`[${new Date().toLocaleTimeString()}] ランク情報なし - 0RRで表示`);
            }

        } else { // stats または stats.data が存在しない場合
            document.getElementById('rankIcon').src = 'assets/images/ranks/unranked.png';
            document.getElementById('rankText').textContent = 'データなし';
            document.getElementById('rrText').textContent = '0RR';
            resetGaugeDisplay('前回のマッチ');
            console.log(`[${new Date().toLocaleTimeString()}] API応答にデータが含まれていません - 0RRで表示`);
        }

        // プレイヤー情報更新後に文字サイズと横幅を調整
        setTimeout(() => {
            adjustTextSize();
            adjustOverlayWidth();

            // クラシックテーマの場合、スマート自動調整を実行
            if (state.currentTheme === 'classic') {
                applyClassicSmartAdjustments();
                setTimeout(handleTextOverflow, 100);
            }
        }, 300);

    } catch (error) {
        console.error(`[${new Date().toLocaleTimeString()}] Error updating player info:`, error);

        // エラー発生時も表示をリセット
        document.getElementById('rankIcon').src = 'assets/images/ranks/unranked.png';
        document.getElementById('rankText').textContent = 'エラー';
        document.getElementById('rrText').textContent = '0RR';
        resetGaugeDisplay('前回のマッチ');
    }
}

// プレイヤー情報更新時に文字サイズも調整
export function updatePlayerInfoWithTextAdjustment(name, tag) {
    return updatePlayerInfo(name, tag).then(() => {
        setTimeout(adjustTextSize, 200); // データ更新後に調整
    });
}
