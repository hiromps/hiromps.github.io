// Championテーマ専用: 完成済み背景画像の上に重ねる動的SVGレイヤーの更新 (ES Module)
// 座標は index.html 内の #championOverlay svg (viewBox 0 0 1672 941) の各要素定義と対応している。
// テーマとランクデータは独立しており、この関数はテーマがChampionでなくても
// (常に)呼び出して構わない。非表示中の要素を更新するだけで見た目には影響しない。
//
// フォントサイズは layout.js の measureTextWidth と同様にCanvasでの実測幅から算出し、
// 枠に収まる最大サイズへ均一スケーリングする(scaleX等による引き伸ばしは行わない)。
// display:none の要素でもCanvas計測は正しく動作するため、非アクティブテーマ中でも
// 事前計算して問題ない。

// 各ゾーンの座標は champion.png をピクセル単位で実測し、装飾の縁(枠線)にぴったり
// 収まるように算出した値(claudedocs/champion-safezone-debug.png の黄枠と対応)。

// ゲージトラック(パネル外周の内側、左枠~600px・右枠~1475px・上枠~572px・下枠~622pxを実測)
const GAUGE_TRACK_X = 605;
const GAUGE_TRACK_WIDTH = 865;

// メインパネル/V飾りパネルは同じ横帯(上枠~380px・下枠~530pxを実測)なので上下境界を共有する
const PANEL_TOP = 385;
const PANEL_BOTTOM = 525;
const CAP_HEIGHT_RATIO = 0.72; // Rajdhani Boldの概算キャップハイト比率(baselineの中央揃え計算に使用)

// baseline中央揃え計算: フォントサイズ分のキャップハイトを PANEL_TOP〜PANEL_BOTTOM の中央に揃える
function centeredBaseline(fontSize) {
    return (PANEL_TOP + PANEL_BOTTOM) / 2 + (CAP_HEIGHT_RATIO * fontSize) / 2;
}

// ランク名専用ゾーン(RRとは独立。メインパネルの内側、左端~460px・右端(縦仕切り線)~1105pxを実測)
// 中央揃え表示のため text-anchor="middle" をindex.html側で指定している
const RANK_NAME_LEFT = 460;
const RANK_NAME_RIGHT = 1095;
const RANK_FONT_MIN = 34;
const RANK_FONT_MAX = 104;

// RR専用ゾーン(右側のV飾りパネルの内側。左枠~1140px・右枠~1560pxを実測。中央揃えで表示)
const RR_ZONE_LEFT = 1140;
const RR_ZONE_RIGHT = 1560;
const RR_MAX_WIDTH = RR_ZONE_RIGHT - RR_ZONE_LEFT;
const RR_FONT_MIN = 36;
const RR_FONT_MAX = 100;
const RR_LABEL_RATIO = 0.42; // RR数値フォントサイズに対する"RR"ラベルの比率
const RR_VALUE_LABEL_GAP_RATIO = 0.14;

// 増減ポイント(ヘキサゴン下部。"+"アイコンを避けた枠内側 x372〜508・y568〜632 の実測値に基づき、
// "pts"のディセンダーを考慮して枠下端(632px)に収まるよう算出。ラベル位置(index.htmlの
// 静的な"LAST MATCH"テキスト、中心x=440・baseline=580)ともx中心を揃えている)
const DELTA_CENTER_X = 440;
const DELTA_BASELINE = 617;
const DELTA_MAX_WIDTH = 136;
const DELTA_FONT_MIN = 20;
const DELTA_FONT_MAX = 44;

let measureCtx = null;
function measureTextWidth(text, fontSizePx, fontWeight) {
    if (!measureCtx) {
        measureCtx = document.createElement('canvas').getContext('2d');
    }
    measureCtx.font = `${fontWeight} ${fontSizePx}px Rajdhani, "Noto Sans JP", sans-serif`;
    return measureCtx.measureText(text).width;
}

export function updateChampionOverlay({ rankName, rankIconSrc, rr, delta }) {
    const badge = document.getElementById('championRankBadge');
    const rankNameEl = document.getElementById('championRankName');
    const rrValueEl = document.getElementById('championRRValue');
    const rrLabelEl = document.getElementById('championRRLabel');
    const deltaEl = document.getElementById('championDelta');
    const gaugeFill = document.getElementById('championGaugeFill');

    if (!badge || !rankNameEl || !rrValueEl || !rrLabelEl || !deltaEl || !gaugeFill) return;

    if (rankIconSrc) {
        badge.setAttribute('href', rankIconSrc);
    }

    const rankText = rankName || 'ランクなし';
    const rrNumber = Number.isFinite(rr) ? rr : 0;
    const rrText = String(rrNumber);

    // ランク名ゾーン: ランク名だけで枠幅に収まる最大フォントサイズを算出(均一スケーリングのみ・引き伸ばし無し)し、
    // ゾーンの水平・垂直中央に配置する
    const rankMaxWidth = RANK_NAME_RIGHT - RANK_NAME_LEFT;
    const rankWidthAtMax = measureTextWidth(rankText, RANK_FONT_MAX, '700');
    let rankFontSize = rankWidthAtMax > rankMaxWidth
        ? RANK_FONT_MAX * (rankMaxWidth / rankWidthAtMax)
        : RANK_FONT_MAX;
    rankFontSize = Math.max(RANK_FONT_MIN, Math.min(RANK_FONT_MAX, rankFontSize));

    rankNameEl.textContent = rankText;
    rankNameEl.setAttribute('x', (RANK_NAME_LEFT + RANK_NAME_RIGHT) / 2);
    rankNameEl.setAttribute('y', centeredBaseline(rankFontSize));
    rankNameEl.style.fontSize = `${rankFontSize}px`;

    // RRゾーン: ランク名とは独立に、ゾーン幅に収まる最大サイズで水平・垂直中央に配置する
    const unitWidth =
        measureTextWidth(rrText, 100, '700') +
        100 * RR_VALUE_LABEL_GAP_RATIO +
        measureTextWidth('RR', 100 * RR_LABEL_RATIO, '600');
    let rrFontSize = unitWidth > 0 ? (RR_MAX_WIDTH / unitWidth) * 100 : RR_FONT_MAX;
    rrFontSize = Math.max(RR_FONT_MIN, Math.min(RR_FONT_MAX, rrFontSize));

    const rrValueFontSize = rrFontSize;
    const rrLabelFontSize = rrFontSize * RR_LABEL_RATIO;
    const gap2 = rrFontSize * RR_VALUE_LABEL_GAP_RATIO;

    const rrValueWidth = measureTextWidth(rrText, rrValueFontSize, '700');
    const rrLabelWidth = measureTextWidth('RR', rrLabelFontSize, '600');
    const rrTotalWidth = rrValueWidth + gap2 + rrLabelWidth;
    const rrValueX = (RR_ZONE_LEFT + RR_ZONE_RIGHT) / 2 - rrTotalWidth / 2;
    const rrBaseline = centeredBaseline(rrValueFontSize);

    rrValueEl.textContent = rrText;
    rrValueEl.setAttribute('x', rrValueX);
    rrValueEl.setAttribute('y', rrBaseline);
    rrValueEl.style.fontSize = `${rrValueFontSize}px`;

    rrLabelEl.setAttribute('x', rrValueX + rrValueWidth + gap2);
    rrLabelEl.setAttribute('y', rrBaseline);
    rrLabelEl.style.fontSize = `${rrLabelFontSize}px`;

    // 増減ポイントを枠(ヘキサゴン内側)に収まる最大フォントサイズで表示
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
    const deltaWidthAtMax = measureTextWidth(deltaText, DELTA_FONT_MAX, '700');
    let deltaFontSize = deltaWidthAtMax > DELTA_MAX_WIDTH
        ? DELTA_FONT_MAX * (DELTA_MAX_WIDTH / deltaWidthAtMax)
        : DELTA_FONT_MAX;
    deltaFontSize = Math.max(DELTA_FONT_MIN, Math.min(DELTA_FONT_MAX, deltaFontSize));

    deltaEl.textContent = deltaText;
    deltaEl.setAttribute('x', DELTA_CENTER_X);
    deltaEl.setAttribute('y', DELTA_BASELINE);
    deltaEl.style.fontSize = `${deltaFontSize}px`;

    const gaugePercentage = Math.min(100, Math.max(0, rrNumber));
    gaugeFill.setAttribute('x', GAUGE_TRACK_X);
    gaugeFill.setAttribute('width', (gaugePercentage / 100) * GAUGE_TRACK_WIDTH);
}
