// エントリポイント (ES Module)
// module は DOMContentLoaded 後に実行されるため、旧 window.addEventListener('DOMContentLoaded', ...) の
// ラップは不要で、トップレベルで直接呼び出す。
import { state } from './state.js';
import { applyTheme, applyClassicSmartAdjustments, handleTextOverflow } from './theme.js';
import {
    resetLastMatchWidthForClassic,
    adjustLastMatchWidth,
    adjustOBSScale,
    observeOverlayResize
} from './layout.js';
import { updatePlayerInfo, resetGaugeDisplay } from './render.js';
import { startAutoUpdate } from './auto-update.js';
import { loadSavedSettings, applyUrlColorParams, initSettingsUI } from './settings.js';
import { initPreview } from './preview.js';
import { updateChampionOverlay } from './champion.js';

// ページ初期化処理
function initializePage() {
    // URLパラメータを取得
    const urlParams = new URLSearchParams(window.location.search);
    const name = urlParams.get('name');
    const tag = urlParams.get('tag');
    const isOBS = urlParams.has('obs');
    const updateFreq = parseInt(urlParams.get('updateInterval')) || 60;

    // プレイヤー情報を状態に設定
    state.currentPlayerName = name;
    state.currentPlayerTag = tag;

    // 初期テーマを確実に適用（クラシックテーマをデフォルトで適用）
    const savedTheme = localStorage.getItem('selectedTheme') || 'classic';
    const urlTheme = urlParams.get('theme') || savedTheme;
    applyTheme(urlTheme);

    // Championのプレースホルダー表示(ランクなし/0RR)を動的レイアウトで初期描画しておく
    // (実データが来るまでの間もフォントサイズ・位置の計算済み状態にするため)
    updateChampionOverlay({ rankName: 'ランクなし', rankIconSrc: 'assets/images/ranks/unranked.png', rr: 0, delta: undefined });

    // URLパラメータから色設定を適用。3キーゲートを満たさない場合は localStorage にフォールバック
    const appliedFromUrl = applyUrlColorParams(urlParams);
    if (!appliedFromUrl) {
        loadSavedSettings();

        // デフォルト値を確実に設定（カスタマイズベース用）
        if (!localStorage.getItem('customRankBgColor')) {
            document.documentElement.style.setProperty('--rank-bg-color', 'rgba(58, 68, 78, 1)');
        }
    }

    if (name && tag) {
        // 入力フォーム非表示・OBSモードの背景透過/ヘッダー非表示/オーバーレイ中央配置・
        // 通常表示でのオーバーレイ中央配置は全て body.obs-mode / body.has-player の
        // CSSルール(<body>直後のbootスクリプトでクラス付与)で処理する

        if (isOBS) {
            // OBSブラウザソースサイズに応じたスケール調整はCSSでは表現できないためJSで実行
            adjustOBSScale();

            // OBSモードでは自動更新を開始
            console.log(`OBSモードで自動更新を有効化（${updateFreq}秒間隔）`);
        }

        // プレイヤー情報を更新（初回）
        updatePlayerInfo(name, tag).then(() => {
            // 初回更新完了後、OBSモードの場合は自動更新を開始
            if (isOBS) {
                startAutoUpdate(updateFreq);
            }
        }).catch(error => {
            console.error('初回データ取得エラー:', error);
            // エラーが発生してもOBSモードなら自動更新を開始(即時1回実行付き)
            if (isOBS) {
                console.log('初回取得に失敗しましたが、OBSモードのため自動更新を開始します');
                startAutoUpdate(updateFreq, { immediate: true });
            }
        });
    } else if (isOBS) {
        // name, tag パラメータがないが OBS モードの場合
        // 入力フォーム・ヘッダー・背景の非表示は body.obs-mode CSS ルールで処理済み

        // データがない旨を表示
        document.getElementById('rankText').textContent = '情報なし';
        document.getElementById('rrText').textContent = '0RR';

        // 前回のマッチセクションも表示
        resetGaugeDisplay('前回のマッチ');
        updateChampionOverlay({ rankName: '情報なし', rankIconSrc: 'assets/images/ranks/unranked.png', rr: 0, delta: undefined });
    }

    // 文字サイズ調整機能を初期化
    observeOverlayResize();

    // 初期化完了後に幅調整を実行（プレビュー画面のみ）
    setTimeout(() => {
        if (state.currentTheme === 'classic') {
            resetLastMatchWidthForClassic();
            // クラシックテーマのスマート自動調整を初期化時に実行
            applyClassicSmartAdjustments();
        } else {
            adjustLastMatchWidth();
        }
    }, 500);

    // プレビュー画面でより確実に幅調整を実行
    setTimeout(() => {
        if (state.currentTheme === 'classic') {
            resetLastMatchWidthForClassic();
            applyClassicSmartAdjustments();
            setTimeout(handleTextOverflow, 100);
        } else {
            adjustLastMatchWidth();
        }
    }, 1000);

    setTimeout(() => {
        if (state.currentTheme === 'classic') {
            resetLastMatchWidthForClassic();
            applyClassicSmartAdjustments();
        } else {
            adjustLastMatchWidth();
        }
    }, 2000);
}

// チュートリアルの開閉機能
function toggleTutorial() {
    const content = document.getElementById('tutorialContent');
    const arrow = document.getElementById('tutorialArrow');

    if (content.classList.contains('expanded')) {
        // 閉じる
        content.classList.remove('expanded');
        arrow.classList.remove('rotated');
    } else {
        // 開く
        content.classList.add('expanded');
        arrow.classList.add('rotated');
    }
}

// ハンバーガーメニューの初期化は js/hamburger-menu.js(classic script、全ページ共通)が担う

document.getElementById('tutorialToggleButton').addEventListener('click', toggleTutorial);

// ページ読み込み時の初期化
initializePage();
initSettingsUI();
initPreview();
