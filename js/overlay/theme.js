// テーマ切替層 (ES Module)
import { state } from './state.js';
import { resetLastMatchWidthForClassic, adjustLastMatchWidth } from './layout.js';
import { refreshChampionOverlay } from './champion.js';

// テーマ定義。type: 'code' はCSS+カスタマイズ可能な既存4テーマ、'image' は背景画像+動的SVGの固定ビジュアル
// (Champion/Chaos等)。zone座標・viewBoxなどレイアウト詳細は champion.js の IMAGE_THEME_LAYOUTS が持つ
// (THEME_META.background はUI/ドキュメント用の参照情報)。
// customizable: false のテーマは colorCustomizationFields が非表示になる(index.html の body.theme-image-type CSSで制御)。
export const THEME_META = {
    classic: { id: 'classic', name: 'クラシック', type: 'code', customizable: true },
    modern: { id: 'modern', name: 'モダン', type: 'code', customizable: true },
    shadcn: { id: 'shadcn', name: 'Cyber', type: 'code', customizable: true },
    neon: { id: 'neon', name: 'Neon', type: 'code', customizable: true },
    champion: { id: 'champion', name: 'Champion', type: 'image', customizable: false, background: 'assets/images/theme/champion.png' },
    chaos: { id: 'chaos', name: 'Chaos', type: 'image', customizable: false, background: 'assets/images/theme/chaos.png' }
};

const ALL_THEME_CLASSES = Object.keys(THEME_META).map(id => `theme-${id}`);

export function applyTheme(theme) {
    const body = document.body;
    // 既存のテーマクラスを削除
    body.classList.remove(...ALL_THEME_CLASSES);
    // 新しいテーマクラスを追加
    body.classList.add(`theme-${theme}`);
    // 画像テーマ(Champion/Chaos等)共通の表示切替クラス。CSS側は個別テーマ名ではなくこちらにフックする
    body.classList.toggle('theme-image-type', THEME_META[theme]?.type === 'image');
    state.currentTheme = theme;

    // テーマをlocalStorageに保存
    localStorage.setItem('selectedTheme', theme);

    // ボタンのアクティブ状態を更新
    document.querySelectorAll('.theme-button').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-theme="${theme}"]`).classList.add('active');

    // オーバーレイの幅をリセット（全テーマでCSSによる最小幅調整が適用される）
    const overlay = document.querySelector('.overlay');
    if (overlay) {
        // インラインスタイルをクリアしてCSSに委譲
        overlay.style.width = '';
        overlay.style.minWidth = '';
        overlay.style.maxWidth = '';
    }

    // 画像テーマの背景/viewBox/座標は選択中テーマ依存のため、切替の都度、直近データで再描画する
    refreshChampionOverlay();

    // Cyberテーマの場合、スキャンライン効果を追加
    if (theme === 'shadcn') {
        setTimeout(addScanLineEffect, 100);
    }

    // クラシックテーマの場合、スマート自動調整を適用
    if (theme === 'classic') {
        setTimeout(() => {
            applyClassicSmartAdjustments();
            handleTextOverflow();
        }, 150);
    }

    // テーマ変更後に前回のマッチセクションの幅を調整（プレビュー画面のみ）
    setTimeout(() => {
        if (theme === 'classic') {
            resetLastMatchWidthForClassic();
            // 追加の調整
            setTimeout(applyClassicSmartAdjustments, 100);
        } else {
            adjustLastMatchWidth();
        }
    }, 200);
}

// VALORANT風スキャンライン効果を追加
export function addScanLineEffect() {
    const rankSection = document.querySelector('.theme-shadcn .rank-section');
    if (rankSection && !rankSection.querySelector('.scan-line')) {
        const scanLine = document.createElement('div');
        scanLine.className = 'scan-line';
        rankSection.appendChild(scanLine);
    }
}

// クラシックテーマのスマート自動調整システム
export function applyClassicSmartAdjustments() {
    if (state.currentTheme !== 'classic') return;

    // モバイル版では自動調整を無効化
    if (window.innerWidth <= 768) {
        console.log('モバイル版のため横幅自動調整をスキップ');
        return;
    }

    const overlay = document.querySelector('.theme-classic .overlay');
    const rankName = document.querySelector('.theme-classic .rank-name');
    const rrText = document.querySelector('.theme-classic .rr');
    const lastMatchText = document.querySelector('.theme-classic .last-match-text');

    if (!overlay || !rankName || !rrText || !lastMatchText) return;

    try {
        // 既存のクラスをリセット（横幅調整クラスは除外）
        rankName.classList.remove('long-text');
        rrText.classList.remove('adjust-size');
        lastMatchText.classList.remove('long-text');

        // テキストの長さを測定
        const rankTextLength = rankName.textContent.length;
        const rrTextLength = rrText.textContent.length;
        const lastMatchTextLength = lastMatchText.textContent.length;

        // ランク名の長さに応じた調整
        if (rankTextLength > 12) {
            rankName.classList.add('long-text');
        }

        // RRテキストの長さに応じた調整
        if (rrTextLength > 6) {
            rrText.classList.add('adjust-size');
        }

        // 前回のマッチテキストの長さに応じた調整
        if (lastMatchTextLength > 20) {
            lastMatchText.classList.add('long-text');
        }

        // 特殊文字や非ラテン文字の処理
        const hasSpecialChars = /[^\x00-\x7F]/.test(rankName.textContent + lastMatchText.textContent);
        if (hasSpecialChars) {
            // 日本語や特殊文字がある場合の調整
            rankName.style.letterSpacing = '0.3px';
            lastMatchText.style.letterSpacing = '0.2px';
        }

        console.log(`クラシックテーマ調整: ランク文字数=${rankTextLength}, RR文字数=${rrTextLength}, マッチ文字数=${lastMatchTextLength}`);

    } catch (error) {
        console.error('クラシックテーマ自動調整エラー:', error);
    }
}

// クラシックテーマの高度な調整（文字が切れる場合の対応）
export function handleTextOverflow() {
    if (state.currentTheme !== 'classic') return;

    const rankNameElement = document.querySelector('.theme-classic .rank-name');
    const rrElement = document.querySelector('.theme-classic .rr');
    const lastMatchElement = document.querySelector('.theme-classic .last-match-text');
    const overlay = document.querySelector('.theme-classic .overlay');

    if (!rankNameElement || !rrElement || !lastMatchElement || !overlay) return;

    // オーバーフロー検出と修正
    [rankNameElement, rrElement, lastMatchElement].forEach(element => {
        if (element.scrollWidth > element.clientWidth) {
            // テキストがオーバーフローしている場合
            const currentFontSize = window.getComputedStyle(element).fontSize;
            const currentSizeNum = parseFloat(currentFontSize);
            const reducedSize = Math.max(currentSizeNum * 0.9, 10); // 最小10px

            element.style.fontSize = `${reducedSize}px`;
            console.log(`テキストオーバーフロー修正: ${element.className} フォントサイズ ${currentFontSize} → ${reducedSize}px`);
        }
    });
}
