// テキスト計測・幅/スケール調整層 (ES Module)
import { state } from './state.js';

// 文字途切れ防止のための動的調整機能
export function adjustTextSize() {
    const overlay = document.querySelector('.overlay');
    if (!overlay) return;

    const rankName = overlay.querySelector('.rank-name');
    const rrText = overlay.querySelector('.rr');
    const lastMatchText = overlay.querySelector('.last-match-text');

    // ランク名の調整
    if (rankName) {
        adjustElementText(rankName, overlay);
    }

    // RRテキストの調整
    if (rrText) {
        adjustElementText(rrText, overlay);
    }

    // 前回のマッチテキストの調整
    if (lastMatchText) {
        adjustElementText(lastMatchText, overlay);
    }

    // 前回のマッチセクションの幅をランクセクションに合わせる
    adjustLastMatchWidth();

    // 全テーマで横幅を自動調整
    adjustOverlayWidth();
}

// 前回のマッチセクションの幅をランクセクションに合わせる機能（プレビュー画面のみ）
export function adjustLastMatchWidth() {
    // URLパラメータがある場合（URL生成後）は何もしない
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('name') || urlParams.has('tag')) {
        return;
    }

    // クラシックテーマの場合は元のデザインを保持
    if (state.currentTheme === 'classic') {
        console.log('クラシックテーマのため幅調整をスキップ');
        return;
    }

    const rankSection = document.querySelector('.rank-section');
    const lastMatchSection = document.querySelector('.last-match-section');

    if (!rankSection || !lastMatchSection) return;

    // ランクセクションの実際の幅を取得
    const rankSectionWidth = rankSection.offsetWidth;

    // プレビュー画面でのみCSS制約を解除して幅と位置を設定（クラシック以外のテーマ）
    lastMatchSection.style.width = rankSectionWidth + 'px';
    lastMatchSection.style.minWidth = rankSectionWidth + 'px';
    lastMatchSection.style.maxWidth = rankSectionWidth + 'px';
    lastMatchSection.style.boxSizing = 'border-box';
    lastMatchSection.style.margin = '0 auto'; // 中央揃え
    lastMatchSection.style.display = 'block'; // ブロック要素として表示

    // ランクセクションと前回のマッチセクションの位置を完全に同期
    const rankSectionRect = rankSection.getBoundingClientRect();
    const overlay = rankSection.closest('.overlay');

    if (overlay) {
        const overlayRect = overlay.getBoundingClientRect();
        const rankLeftOffset = rankSectionRect.left - overlayRect.left;

        // 前回のマッチセクションをランクセクションと同じ左位置に配置
        lastMatchSection.style.marginLeft = rankLeftOffset + 'px';
        lastMatchSection.style.marginRight = 'auto';
    }

    console.log(`前回のマッチセクション幅調整（プレビュー画面・${state.currentTheme}テーマ）: ${rankSectionWidth}px`);
}

// クラシックテーマ用にスタイルをリセットする機能（再構築版）
export function resetLastMatchWidthForClassic() {
    // URLパラメータがある場合（URL生成後）は何もしない
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('name') || urlParams.has('tag')) {
        return;
    }

    const lastMatchSection = document.querySelector('.last-match-section');
    const rankSection = document.querySelector('.rank-section');
    if (!lastMatchSection || !rankSection) return;

    // クラシックテーマでは新しいCSS構造により自動的に幅が統一される
    // 追加のスタイル調整をリセット
    lastMatchSection.style.width = '';
    lastMatchSection.style.minWidth = '';
    lastMatchSection.style.maxWidth = '';
    lastMatchSection.style.marginLeft = '';
    lastMatchSection.style.marginRight = '';

    console.log('クラシックテーマ: CSS構造により自動幅統一');
}

// 全テーマの横幅自動調整機能（最小幅に調整）
export function adjustOverlayWidth() {
    const overlay = document.querySelector('.overlay');
    if (!overlay) return;

    // 全テーマでCSSによる最小幅調整が適用される
    console.log(`${state.currentTheme}テーマ: CSSによる最小幅調整を適用`);
}

export function adjustElementText(element, container) {
    // 前回のマッチテキストは調整をスキップ（専用のコンテナ幅を使用するため）
    if (element && element.classList.contains('last-match-text')) {
        return;
    }

    const containerWidth = container.offsetWidth;
    const elementWidth = element.scrollWidth;

    // テキストがコンテナより大きい場合
    if (elementWidth > containerWidth * 0.9) {
        const currentFontSize = parseFloat(window.getComputedStyle(element).fontSize);
        const ratio = (containerWidth * 0.85) / elementWidth;
        const newFontSize = Math.max(currentFontSize * ratio, 10); // 最小10px

        element.style.fontSize = newFontSize + 'px';
    }
}

// OBSブラウザソースサイズに応じてオーバーレイをスケール調整
export function adjustOBSScale() {
    const overlay = document.querySelector('.overlay');
    if (!overlay || !document.body.classList.contains('obs-mode')) return;

    // ブラウザソースのサイズを取得
    const browserWidth = window.innerWidth;
    const browserHeight = window.innerHeight;

    // 基準サイズ（450x200）に対するスケール比を計算
    const baseWidth = 450;
    const baseHeight = 200;

    const scaleX = browserWidth / baseWidth;
    const scaleY = browserHeight / baseHeight;

    // 縦横比を保持してスケール（小さい方のスケールを使用）
    const scale = Math.min(scaleX, scaleY, 3); // 最大3倍まで

    // スケール適用
    overlay.style.transform = `translate(-50%, -50%) scale(${scale})`;

    console.log(`OBSスケール調整: ${browserWidth}x${browserHeight} → スケール ${scale.toFixed(2)}`);
}

// ウィンドウサイズ変更時にスケール調整
window.addEventListener('resize', function () {
    if (document.body.classList.contains('obs-mode')) {
        adjustOBSScale();
    }
});

// オーバーレイのサイズ変更監視
export function observeOverlayResize() {
    const overlay = document.querySelector('.overlay');
    if (!overlay) return;

    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            setTimeout(adjustTextSize, 100); // 少し遅延させて確実に調整
        }
    });

    resizeObserver.observe(overlay);
}

// テキスト幅測定ヘルパー関数
export function measureTextWidth(text, fontSize, fontFamily = 'Inter, sans-serif', fontWeight = '400') {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = `${fontWeight} ${fontSize} ${fontFamily}`;
    return context.measureText(text).width;
}

// レスポンシブフォントサイズ計算
export function calculateOptimalFontSize(text, containerWidth, baseFontSize = '1rem') {
    const maxWidth = containerWidth * 0.9; // 90%の幅を使用
    const textWidth = measureTextWidth(text, baseFontSize);

    if (textWidth <= maxWidth) {
        return baseFontSize;
    }

    // 幅に収まるようにフォントサイズを調整
    const scaleFactor = maxWidth / textWidth;
    const baseSizeNum = parseFloat(baseFontSize);
    const adjustedSize = Math.max(baseSizeNum * scaleFactor, 0.7); // 最小0.7rem

    return `${adjustedSize}rem`;
}
