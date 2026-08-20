// フォーム入力に対するリアルタイムプレビュー層 (ES Module)
// fetchPlayerStats / getRankImageUrl は js/api.js (classic script) が定義するグローバル関数を参照する
import { updateChampionOverlay } from './champion.js';

let previewTimeout = null;
let isPreviewLoading = false;

export function updatePreview() {
    const playerName = document.getElementById('playerName').value.trim();
    const playerTag = document.getElementById('playerTag').value.trim();
    const previewStatus = document.getElementById('previewStatus');

    // 入力が空の場合
    if (!playerName || !playerTag) {
        previewStatus.textContent = 'データを入力してください';
        previewStatus.className = 'preview-status';
        resetPreviewDisplay();
        return;
    }

    // 前回のタイムアウトをクリア
    if (previewTimeout) {
        clearTimeout(previewTimeout);
    }

    // ステータス更新
    previewStatus.textContent = '読み込み中...';
    previewStatus.className = 'preview-status loading';

    // デバウンス処理（500ms後に実行）
    previewTimeout = setTimeout(() => {
        loadPreviewData(playerName, playerTag);
    }, 500);
}

export async function loadPreviewData(name, tag) {
    if (isPreviewLoading) return;
    isPreviewLoading = true;

    const previewStatus = document.getElementById('previewStatus');

    try {
        console.log(`[Preview] プレビューデータを読み込み中: ${name}#${tag}`);

        // API呼び出し（既存の関数を使用）
        const stats = await fetchPlayerStats(name, tag);

        console.log('[Preview] API Response:', stats);

        if (!stats || !stats.data) {
            const notFoundError = new Error('プレイヤーが見つかりません');
            notFoundError.status = 404; // describeApiError() で「見つからない」系のメッセージに分類させる
            throw notFoundError;
        }

        // プレビュー更新（stats.dataを直接渡す）
        updatePreviewDisplay(stats.data);

        previewStatus.textContent = `✓ ${name}#${tag}`;
        previewStatus.className = 'preview-status success';

        console.log('[Preview] プレビュー更新完了');

    } catch (error) {
        console.error('[Preview] エラー:', error);
        previewStatus.textContent = `✗ ${describeApiError(error)}`;
        previewStatus.className = 'preview-status error';
        resetPreviewDisplay();
    } finally {
        isPreviewLoading = false;
    }
}

export function updatePreviewDisplay(playerData) {
    console.log('[Preview] Updating display with data:', playerData);

    // ランク情報更新
    const rankIcon = document.getElementById('rankIcon');
    const rankText = document.getElementById('rankText');
    const rrText = document.getElementById('rrText');

    if (playerData && playerData.currenttierpatched) {
        const rankName = playerData.currenttierpatched;
        const rr = playerData.ranking_in_tier || 0;
        const mmrChange = playerData.mmr_change_to_last_game;

        console.log(`[Preview] Rank: ${rankName}, RR: ${rr}, MMR Change: ${mmrChange}`);

        rankText.textContent = rankName;
        rrText.textContent = `${rr}RR`;

        // ランクアイコン更新（APIの画像URLを優先）
        if (playerData.images && playerData.images.large) {
            rankIcon.src = playerData.images.large;
        } else {
            // フォールバック：ローカル画像（英語ランク名→ファイル名の変換が必要）
            rankIcon.src = getRankImageUrl(rankName);
        }
        rankIcon.alt = rankName;

        // 最終マッチ情報更新
        const lastMatchSection = document.getElementById('lastMatchSection');
        const lastMatchText = document.getElementById('lastMatchText');
        const mmrGaugeFill = document.querySelector('.mmr-gauge-fill');

        if (mmrChange !== undefined) {
            const sign = mmrChange >= 0 ? '+' : '';
            lastMatchText.textContent = `前回のマッチ ${sign}${mmrChange}pts`;

            // RR値に基づいてゲージを表示
            const gaugePercentage = Math.min(100, Math.max(0, rr));
            mmrGaugeFill.style.width = `${gaugePercentage}%`;
            mmrGaugeFill.style.backgroundColor = '#4CAF50';
            mmrGaugeFill.style.left = '0';
            mmrGaugeFill.style.right = 'auto';

            lastMatchSection.style.display = 'flex';
        } else {
            lastMatchText.textContent = '前回のマッチ';
            mmrGaugeFill.style.width = `${Math.min(100, rr)}%`;
            mmrGaugeFill.style.backgroundColor = '#4CAF50';
            lastMatchSection.style.display = 'flex';
        }

        updateChampionOverlay({ rankName, rankIconSrc: rankIcon.src, rr, delta: mmrChange });
    } else {
        console.log('[Preview] No rank data available');
        resetPreviewDisplay();
    }
}

export function resetPreviewDisplay() {
    // デフォルト表示に戻す
    const rankIcon = document.getElementById('rankIcon');
    const rankText = document.getElementById('rankText');
    const rrText = document.getElementById('rrText');
    const lastMatchSection = document.getElementById('lastMatchSection');

    rankIcon.src = 'assets/images/ranks/unranked.png';
    rankIcon.alt = 'ランクなし';
    rankText.textContent = 'ランクなし';
    rrText.textContent = '0RR';
    lastMatchSection.style.display = 'none';

    updateChampionOverlay({ rankName: 'ランクなし', rankIconSrc: 'assets/images/ranks/unranked.png', rr: 0, delta: undefined });
}

// プレイヤー名/タグ入力欄のリアルタイムプレビュー配線
export function initPreview() {
    document.getElementById('playerName').addEventListener('input', updatePreview);
    document.getElementById('playerTag').addEventListener('input', updatePreview);
}
