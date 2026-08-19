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
import { startAutoUpdate, startOBSAutoUpdate } from './auto-update.js';
import { loadSavedSettings, applyUrlColorParams, initSettingsUI } from './settings.js';
import { initPreview } from './preview.js';

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
        // URLパラメータがある場合は入力フォームを非表示
        document.getElementById('inputSection').style.display = 'none';

        if (isOBS) {
            // OBSモードの場合のスタイル調整
            document.documentElement.style.backgroundColor = 'transparent';
            document.body.style.backgroundColor = 'transparent';
            document.body.style.overflow = 'hidden';
            // bodyにOBSモードクラスを追加
            document.body.classList.add('obs-mode');

            // ヘッダーナビゲーションを非表示
            const headerElement = document.querySelector('.app-header');
            if (headerElement) {
                headerElement.style.display = 'none';
            }

            // 背景アニメーション要素を非表示
            const backgroundElement = document.querySelector('.background');
            if (backgroundElement) {
                backgroundElement.style.display = 'none';
            }

            // オーバーレイのOBS向け位置調整（中央に配置）
            const overlayElement = document.querySelector('.overlay');
            if (overlayElement) {
                overlayElement.style.position = 'absolute';
                overlayElement.style.top = '50%';
                overlayElement.style.left = '50%';
                overlayElement.style.right = 'auto';
                overlayElement.style.transform = 'translate(-50%, -50%)';

                // OBSブラウザソースサイズに応じてスケール調整
                adjustOBSScale();
            }

            // OBSモードでは自動更新を開始
            console.log(`OBSモードで自動更新を有効化（${updateFreq}秒間隔）`);

        } else {
            // 通常のブラウザ表示でのオーバーレイ位置調整
            document.querySelector('.overlay').style.top = '50%';
            document.querySelector('.overlay').style.transform = 'translateY(-50%)';
        }

        // プレイヤー情報を更新（初回）
        updatePlayerInfo(name, tag).then(() => {
            // 初回更新完了後、OBSモードの場合は自動更新を開始
            if (isOBS) {
                startAutoUpdate(updateFreq);
            }
        }).catch(error => {
            console.error('初回データ取得エラー:', error);
            // エラーが発生してもOBSモードなら自動更新を開始
            if (isOBS) {
                console.log('初回取得に失敗しましたが、OBSモードのため自動更新を開始します');
                startOBSAutoUpdate(updateFreq);
            }
        });

        // OBSモードの場合、初回更新と並行して自動更新も開始（フォールバック）
        if (isOBS) {
            // 少し遅延させてから自動更新を確実に開始
            setTimeout(() => {
                if (!state.isAutoUpdateEnabled) {
                    console.log('フォールバック: OBS自動更新を強制開始');
                    startOBSAutoUpdate(updateFreq);
                }
            }, 2000);
        }
    } else if (isOBS) {
        // name, tag パラメータがないが OBS モードの場合
        document.getElementById('inputSection').style.display = 'none';

        // ヘッダーナビゲーションを非表示
        const headerElement = document.querySelector('.app-header');
        if (headerElement) {
            headerElement.style.display = 'none';
        }

        // bodyにOBSモードクラスを追加
        document.body.classList.add('obs-mode');

        const backgroundElement = document.querySelector('.background');
        if (backgroundElement) {
            backgroundElement.style.display = 'none';
        }
        // データがない旨を表示
        document.getElementById('rankText').textContent = '情報なし';
        document.getElementById('rrText').textContent = '0RR';

        // 前回のマッチセクションも表示
        resetGaugeDisplay('前回のマッチ');
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

document.getElementById('tutorialToggleButton').addEventListener('click', toggleTutorial);

// ページ読み込み時の初期化
initializePage();
initializeHamburgerMenu();
initSettingsUI();
initPreview();
