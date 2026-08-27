// 画像テーマ系統(Champion/Chaos等)専用: 完成済み背景画像の上に重ねる動的SVGレイヤーの更新 (ES Module)
// 座標は index.html 内の #championOverlay svg の各要素定義と対応している。svgのviewBoxと
// <img class="champion-bg"> の src は、選択中テーマに応じてこのファイルが毎回書き換える
// (テーマごとに背景PNGの実ピクセルサイズ・ゾーン位置が異なるため)。
//
// テーマとランクデータは独立しており、この関数はテーマが画像タイプでなくても
// (常に)呼び出して構わない。非表示中の要素を更新するだけで見た目には影響しない。
//
// フォントサイズは layout.js の measureTextWidth と同様にCanvasでの実測幅から算出し、
// 枠に収まる最大サイズへ均一スケーリングする(scaleX等による引き伸ばしは行わない)。
// display:none の要素でもCanvas計測は正しく動作するため、非アクティブテーマ中でも
// 事前計算して問題ない。
import { state } from './state.js';

// 各テーマのゾーン座標は背景PNGをピクセル単位で実測して算出した値。
// champion: claudedocs/champion-safezone-debug.png の黄枠と対応(viewBox 0 0 1672 941)。
// chaos: claudedocs/chaos-safezone-debug.png の黄枠と対応(viewBox 0 0 1200 896)。
// 新しい画像テーマを追加する場合は assets/images/theme/DESIGN.md の手順に沿って計測し、
// このオブジェクトにエントリを追加する(index.html/theme.jsの改修は不要)。
const IMAGE_THEME_LAYOUTS = {
    champion: {
        background: 'assets/images/theme/champion.png',
        viewBox: '0 0 1672 941',
        badge: { x: 115, y: 329, size: 250 },
        panel: { top: 385, bottom: 525 },
        rankNameZone: { left: 460, right: 1095 },
        rrZone: { left: 1140, right: 1560 },
        rankFont: { min: 34, max: 104 },
        rrFont: { min: 36, max: 100 },
        hasLastMatchLabel: true,
        lastMatchLabel: { x: 440, y: 580 },
        delta: { centerX: 440, baseline: 617, maxWidth: 136, fontMin: 20, fontMax: 44 },
        gaugeTrack: { x: 605, y: 576, width: 865, height: 44 }
    },
    chaos: {
        background: 'assets/images/theme/chaos.png',
        viewBox: '0 0 1200 896',
        badge: { x: 85, y: 349, size: 157 },
        panel: { top: 361, bottom: 471 },
        rankNameZone: { left: 303, right: 826 },
        rrZone: { left: 844, right: 1137 },
        rankFont: { min: 26, max: 81 },
        rrFont: { min: 28, max: 78 },
        // chaosのdeltaパネルは縦幅が狭く、"LAST MATCH"見出しと数値を2段で収める余地がないため見出しは非表示にする
        hasLastMatchLabel: false,
        delta: { centerX: 313, baseline: 539, maxWidth: 112, fontMin: 14, fontMax: 26 },
        gaugeTrack: { x: 474, y: 521, width: 661, height: 26 }
    }
};

const CAP_HEIGHT_RATIO = 0.72; // Rajdhani Boldの概算キャップハイト比率(baselineの中央揃え計算に使用)
const RR_LABEL_RATIO = 0.42; // RR数値フォントサイズに対する"RR"ラベルの比率
const RR_VALUE_LABEL_GAP_RATIO = 0.14;

function getActiveLayout() {
    return IMAGE_THEME_LAYOUTS[state.currentTheme] || IMAGE_THEME_LAYOUTS.champion;
}

// baseline中央揃え計算: フォントサイズ分のキャップハイトをpanel.top〜panel.bottomの中央に揃える
function centeredBaseline(panel, fontSize) {
    return (panel.top + panel.bottom) / 2 + (CAP_HEIGHT_RATIO * fontSize) / 2;
}

let measureCtx = null;
function measureTextWidth(text, fontSizePx, fontWeight) {
    if (!measureCtx) {
        measureCtx = document.createElement('canvas').getContext('2d');
    }
    measureCtx.font = `${fontWeight} ${fontSizePx}px Rajdhani, "Noto Sans JP", sans-serif`;
    return measureCtx.measureText(text).width;
}

let lastOverlayData = null;

export function updateChampionOverlay(data) {
    lastOverlayData = data;
    const { rankName, rankIconSrc, rr, delta } = data;
    const layout = getActiveLayout();

    const bg = document.querySelector('#championOverlay .champion-bg');
    const svg = document.querySelector('#championOverlay .champion-svg');
    const badge = document.getElementById('championRankBadge');
    const rankNameEl = document.getElementById('championRankName');
    const rrValueEl = document.getElementById('championRRValue');
    const rrLabelEl = document.getElementById('championRRLabel');
    const lastMatchLabelEl = document.getElementById('championLastMatchLabel');
    const deltaEl = document.getElementById('championDelta');
    const gaugeFill = document.getElementById('championGaugeFill');
    const gaugeTrackClip = document.getElementById('championGaugeTrackClip');

    if (!badge || !rankNameEl || !rrValueEl || !rrLabelEl || !deltaEl || !gaugeFill) return;

    // 背景画像とSVG座標系を選択中テーマに合わせる(テーマごとに実ピクセルサイズが異なるため)
    if (bg && bg.getAttribute('src') !== layout.background) {
        bg.setAttribute('src', layout.background);
    }
    if (svg) {
        svg.setAttribute('viewBox', layout.viewBox);
    }

    // ランクバッジ枠
    badge.setAttribute('x', layout.badge.x);
    badge.setAttribute('y', layout.badge.y);
    badge.setAttribute('width', layout.badge.size);
    badge.setAttribute('height', layout.badge.size);
    if (rankIconSrc) {
        badge.setAttribute('href', rankIconSrc);
    }

    const rankText = rankName || 'ランクなし';
    const rrNumber = Number.isFinite(rr) ? rr : 0;
    const rrText = String(rrNumber);

    // ランク名ゾーン: ランク名だけで枠幅に収まる最大フォントサイズを算出(均一スケーリングのみ・引き伸ばし無し)し、
    // ゾーンの水平・垂直中央に配置する
    const { rankNameZone, rrZone, rankFont, rrFont, panel } = layout;
    const rankMaxWidth = rankNameZone.right - rankNameZone.left;
    const rankWidthAtMax = measureTextWidth(rankText, rankFont.max, '700');
    let rankFontSize = rankWidthAtMax > rankMaxWidth
        ? rankFont.max * (rankMaxWidth / rankWidthAtMax)
        : rankFont.max;
    rankFontSize = Math.max(rankFont.min, Math.min(rankFont.max, rankFontSize));

    rankNameEl.textContent = rankText;
    rankNameEl.setAttribute('x', (rankNameZone.left + rankNameZone.right) / 2);
    rankNameEl.setAttribute('y', centeredBaseline(panel, rankFontSize));
    rankNameEl.style.fontSize = `${rankFontSize}px`;

    // RRゾーン: ランク名とは独立に、ゾーン幅に収まる最大サイズで水平・垂直中央に配置する
    const rrMaxWidth = rrZone.right - rrZone.left;
    const unitWidth =
        measureTextWidth(rrText, 100, '700') +
        100 * RR_VALUE_LABEL_GAP_RATIO +
        measureTextWidth('RR', 100 * RR_LABEL_RATIO, '600');
    let rrFontSize = unitWidth > 0 ? (rrMaxWidth / unitWidth) * 100 : rrFont.max;
    rrFontSize = Math.max(rrFont.min, Math.min(rrFont.max, rrFontSize));

    const rrValueFontSize = rrFontSize;
    const rrLabelFontSize = rrFontSize * RR_LABEL_RATIO;
    const gap2 = rrFontSize * RR_VALUE_LABEL_GAP_RATIO;

    const rrValueWidth = measureTextWidth(rrText, rrValueFontSize, '700');
    const rrLabelWidth = measureTextWidth('RR', rrLabelFontSize, '600');
    const rrTotalWidth = rrValueWidth + gap2 + rrLabelWidth;
    const rrValueX = (rrZone.left + rrZone.right) / 2 - rrTotalWidth / 2;
    const rrBaseline = centeredBaseline(panel, rrValueFontSize);

    rrValueEl.textContent = rrText;
    rrValueEl.setAttribute('x', rrValueX);
    rrValueEl.setAttribute('y', rrBaseline);
    rrValueEl.style.fontSize = `${rrValueFontSize}px`;

    rrLabelEl.setAttribute('x', rrValueX + rrValueWidth + gap2);
    rrLabelEl.setAttribute('y', rrBaseline);
    rrLabelEl.style.fontSize = `${rrLabelFontSize}px`;

    // "LAST MATCH"見出し: テーマにゾーンの縦幅の余地がない場合は非表示にする
    if (lastMatchLabelEl) {
        if (layout.hasLastMatchLabel && layout.lastMatchLabel) {
            lastMatchLabelEl.style.display = '';
            lastMatchLabelEl.setAttribute('x', layout.lastMatchLabel.x);
            lastMatchLabelEl.setAttribute('y', layout.lastMatchLabel.y);
        } else {
            lastMatchLabelEl.style.display = 'none';
        }
    }

    // 増減ポイントを枠(deltaゾーン)に収まる最大フォントサイズで表示
    let deltaText;
    if (typeof delta === 'number' && Number.isFinite(delta)) {
        const sign = delta >= 0 ? '+' : '';
        deltaText = `${sign}${delta}pts`;
        deltaEl.classList.toggle('is-positive', delta > 0);
        deltaEl.classList.toggle('is-negative', delta < 0);
    } else {
        deltaText = '±0pts';
        deltaEl.classList.remove('is-positive', 'is-negative');
    }
    const deltaWidthAtMax = measureTextWidth(deltaText, layout.delta.fontMax, '700');
    let deltaFontSize = deltaWidthAtMax > layout.delta.maxWidth
        ? layout.delta.fontMax * (layout.delta.maxWidth / deltaWidthAtMax)
        : layout.delta.fontMax;
    deltaFontSize = Math.max(layout.delta.fontMin, Math.min(layout.delta.fontMax, deltaFontSize));

    deltaEl.textContent = deltaText;
    deltaEl.setAttribute('x', layout.delta.centerX);
    deltaEl.setAttribute('y', layout.delta.baseline);
    deltaEl.style.fontSize = `${deltaFontSize}px`;

    // ゲージトラック(枠)とゲージ塗り(fill)を選択中テーマのゾーンに合わせる
    const { gaugeTrack } = layout;
    if (gaugeTrackClip) {
        gaugeTrackClip.setAttribute('x', gaugeTrack.x);
        gaugeTrackClip.setAttribute('y', gaugeTrack.y);
        gaugeTrackClip.setAttribute('width', gaugeTrack.width);
        gaugeTrackClip.setAttribute('height', gaugeTrack.height);
        gaugeTrackClip.setAttribute('rx', gaugeTrack.height / 2);
        gaugeTrackClip.setAttribute('ry', gaugeTrack.height / 2);
    }
    const gaugePercentage = Math.min(100, Math.max(0, rrNumber));
    gaugeFill.setAttribute('x', gaugeTrack.x);
    gaugeFill.setAttribute('y', gaugeTrack.y);
    gaugeFill.setAttribute('height', gaugeTrack.height);
    gaugeFill.setAttribute('width', (gaugePercentage / 100) * gaugeTrack.width);
}

// テーマ切替直後にも直近のランクデータで即座に再描画するためのフック(theme.jsから呼ばれる)。
// まだ一度もupdateChampionOverlayが呼ばれていない場合は何もしない(初期化時に呼ばれるため通常は発生しない)。
export function refreshChampionOverlay() {
    if (lastOverlayData) {
        updateChampionOverlay(lastOverlayData);
    }
}
