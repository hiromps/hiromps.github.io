// カラーカスタマイズ・URL生成層 (ES Module)
import { state } from './state.js';
import { applyTheme } from './theme.js';
import { resetLastMatchWidthForClassic, adjustLastMatchWidth } from './layout.js';

// 8色設定を一元管理するテーブル。apply/reset/load/URL適用/generateURL の5経路がこれをループする。
// pairPicker: true のフィールドは loadSavedSettings のピッカー復元時に color/opacity を対で扱う。
// border だけ false で、色と不透明度を独立に復元する(元コードの非対称挙動をそのまま温存)。
export const COLOR_SETTINGS = [
    { param: 'rankBgColor', opacityParam: 'rankBgOpacity', lsColor: 'customRankBgColor', lsOpacity: 'customRankBgOpacity', inputId: 'rankBgColorPicker', sliderId: 'rankBgOpacitySlider', valueId: 'rankBgOpacityValue', cssVar: '--rank-bg-color', defColor: '#3a444e', defOpacity: '100', pairPicker: true },
    { param: 'lastMatchBgColor', opacityParam: 'lastMatchBgOpacity', lsColor: 'customLastMatchBgColor', lsOpacity: 'customLastMatchBgOpacity', inputId: 'lastMatchBgColorPicker', sliderId: 'lastMatchBgOpacitySlider', valueId: 'lastMatchBgOpacityValue', cssVar: '--last-match-bg-color', defColor: '#F44336', defOpacity: '100', pairPicker: true },
    { param: 'textColor', opacityParam: null, lsColor: 'customTextColor', lsOpacity: null, inputId: 'textColorPicker', sliderId: null, valueId: null, cssVar: '--text-color', defColor: '#ffffff', defOpacity: null, pairPicker: true },
    { param: 'rrColor', opacityParam: null, lsColor: 'customRrColor', lsOpacity: null, inputId: 'rrColorPicker', sliderId: null, valueId: null, cssVar: '--rr-color', defColor: '#ff4655', defOpacity: null, pairPicker: true },
    { param: 'borderColor', opacityParam: 'borderOpacity', lsColor: 'customBorderColor', lsOpacity: 'customBorderOpacity', inputId: 'borderColorPicker', sliderId: 'borderOpacitySlider', valueId: 'borderOpacityValue', cssVar: '--border-color', defColor: '#ff4655', defOpacity: '100', pairPicker: false }
];

// hex(#rrggbb) + 不透明度(0-100) → rgba() 文字列。旧コードは同じ変換を4箇所(9回)に手書きコピーしていた。
function hexToRgba(hex, opacityPct) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacityPct / 100})`;
}

// opacityParam を持つ設定は rgba に変換、持たない設定(text/rr)はそのまま色文字列を使う
function cssValue(entry, color, opacity) {
    return entry.opacityParam ? hexToRgba(color, opacity) : color;
}

// カラーピッカーモーダルの表示/非表示
export function showColorPicker() {
    const modal = document.getElementById('colorPickerModal');
    modal.style.display = 'flex';
}

export function closeColorPicker() {
    const modal = document.getElementById('colorPickerModal');
    modal.style.display = 'none';

    // モーダルを閉じた後に幅調整を実行（プレビュー画面のみ）
    setTimeout(() => {
        if (state.currentTheme === 'classic') {
            resetLastMatchWidthForClassic();
        } else {
            adjustLastMatchWidth();
        }
    }, 300);
}

// カスタムカラーの適用
export function applyCustomColors() {
    COLOR_SETTINGS.forEach(entry => {
        const color = document.getElementById(entry.inputId).value;
        const opacity = entry.sliderId ? document.getElementById(entry.sliderId).value : null;

        document.documentElement.style.setProperty(entry.cssVar, cssValue(entry, color, opacity));

        localStorage.setItem(entry.lsColor, color);
        if (entry.lsOpacity) {
            localStorage.setItem(entry.lsOpacity, opacity);
        }
    });

    // プレイヤー名/タグが入力済みなら、今適用したカスタマイズ内容をURLへ即座に反映する
    // (URLをコピーするだけでこのテーマ・配色がそのまま使えるようにするため)
    refreshGeneratedURLIfReady();

    closeColorPicker();

    // カスタムカラー適用後に幅調整を実行（プレビュー画面のみ）
    setTimeout(() => {
        if (state.currentTheme === 'classic') {
            resetLastMatchWidthForClassic();
        } else {
            adjustLastMatchWidth();
        }
    }, 300);
}

// カスタムカラーをリセット
export function resetCustomColors() {
    COLOR_SETTINGS.forEach(entry => {
        // デフォルト値に戻す
        document.getElementById(entry.inputId).value = entry.defColor;
        if (entry.sliderId) {
            document.getElementById(entry.sliderId).value = entry.defOpacity;
            document.getElementById(entry.valueId).textContent = entry.defOpacity + '%';
        }

        // CSS変数をリセット
        document.documentElement.style.setProperty(entry.cssVar, cssValue(entry, entry.defColor, entry.defOpacity));

        // localStorageからカスタム設定を削除
        localStorage.removeItem(entry.lsColor);
        if (entry.lsOpacity) {
            localStorage.removeItem(entry.lsOpacity);
        }
    });

    // テーマをクラシックに戻す
    applyTheme('classic');

    // プレイヤー名/タグが入力済みなら、リセット後のデフォルト状態をURLへ即座に反映する
    refreshGeneratedURLIfReady();

    // リセット後に幅調整を実行（プレビュー画面のみ）
    setTimeout(() => {
        // リセット後はクラシックテーマになるので、クラシック用の処理を実行
        resetLastMatchWidthForClassic();
    }, 300);
}

// 保存された設定を読み込む
export function loadSavedSettings() {
    const saved = {};
    COLOR_SETTINGS.forEach(entry => {
        saved[entry.param] = {
            color: localStorage.getItem(entry.lsColor),
            opacity: entry.lsOpacity ? localStorage.getItem(entry.lsOpacity) : null
        };
    });
    const savedTheme = localStorage.getItem('selectedTheme');

    const rank = saved.rankBgColor;
    const text = saved.textColor;

    // 3キーゲート: rankBgColor && rankBgOpacity && textColor が揃った時のみ復元する
    if (rank.color && rank.opacity && text.color) {
        COLOR_SETTINGS.forEach(entry => {
            const s = saved[entry.param];
            const hasPair = entry.opacityParam ? (s.color && s.opacity) : !!s.color;

            // CSS変数の復元(rank/textは3キーゲートで既に確定、lastMatch/borderはペア条件、rrは単独条件)
            if (hasPair) {
                document.documentElement.style.setProperty(entry.cssVar, cssValue(entry, s.color, s.opacity));
            }

            // カラーピッカーUIの復元
            if (entry.pairPicker) {
                // ペア条件(rank/lastMatch/text/rr): 揃った時だけ全フィールドを復元
                if (hasPair) {
                    document.getElementById(entry.inputId).value = s.color;
                    if (entry.sliderId) {
                        document.getElementById(entry.sliderId).value = s.opacity;
                        document.getElementById(entry.valueId).textContent = s.opacity + '%';
                    }
                }
            } else {
                // 独立条件(border): 色と不透明度を別々に復元(元コードの非対称挙動を温存)
                if (s.color) {
                    document.getElementById(entry.inputId).value = s.color;
                }
                if (entry.sliderId && s.opacity) {
                    document.getElementById(entry.sliderId).value = s.opacity;
                    document.getElementById(entry.valueId).textContent = s.opacity + '%';
                }
            }
        });
    }

    // テーマ設定を適用
    if (savedTheme) {
        applyTheme(savedTheme);
    }
}

// プレイヤー名/タグ + 現在のカスタマイズ(localStorageに保存済みの色・テーマ)からURLを組み立てる。
// 未入力の場合は null を返す（呼び出し側でアラート表示するか黙って何もしないかを選べるようにする）。
function buildGeneratedURL() {
    const playerName = document.getElementById('playerName').value;
    const playerTag = document.getElementById('playerTag').value;

    if (!playerName || !playerTag) {
        return null;
    }

    const currentURL = window.location.href.split('?')[0];
    const urlParams = new URLSearchParams();
    urlParams.append('name', playerName);
    urlParams.append('tag', playerTag);
    urlParams.append('obs', ''); // OBSモードパラメータをデフォルトで追加
    // 自動更新間隔。Worker側のキャッシュ保持時間(エッジ180秒/ブラウザ60秒)より
    // 短くしてもキャッシュが返るだけで表示は変わらないため、60秒にしている。
    // 一度配布したURLはこの値が焼き込まれたまま変更できないので、短くしすぎないこと。
    urlParams.append('updateInterval', '60');

    // カスタマイズ設定をURLパラメータとして追加(色ごとに独立して存在チェック)
    COLOR_SETTINGS.forEach(entry => {
        const color = localStorage.getItem(entry.lsColor);
        if (color) urlParams.append(entry.param, color);
        if (entry.lsOpacity) {
            const opacity = localStorage.getItem(entry.lsOpacity);
            if (opacity) urlParams.append(entry.opacityParam, opacity);
        }
    });

    const savedTheme = localStorage.getItem('selectedTheme');
    if (savedTheme) urlParams.append('theme', savedTheme);

    return `${currentURL}?${urlParams.toString()}`;
}

export function generateURL() {
    const newURL = buildGeneratedURL();

    if (!newURL) {
        alert('プレイヤー名とタグを入力してください。');
        return;
    }

    document.getElementById('generatedURL').value = newURL;
}

// カスタマイズ適用/リセット直後に呼ぶ。プレイヤー名/タグが未入力ならアラートを出さず何もしない
// (まだURLを生成する段階ではないだけなので、カスタマイズ操作の妨げにしない)。
function refreshGeneratedURLIfReady() {
    const newURL = buildGeneratedURL();
    if (newURL) {
        document.getElementById('generatedURL').value = newURL;
    }
}

export function copyURL() {
    const urlInput = document.getElementById('generatedURL');
    const url = urlInput.value;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            alert('URLをコピーしました！');
        }).catch(() => {
            // クリップボードAPIが権限等で失敗した場合は execCommand にフォールバック
            urlInput.select();
            document.execCommand('copy');
            alert('URLをコピーしました！');
        });
    } else {
        // navigator.clipboard 非対応ブラウザ(古いOBS内蔵CEF等)向けフォールバック
        urlInput.select();
        document.execCommand('copy');
        alert('URLをコピーしました！');
    }
}

// URLパラメータから色設定を適用する。3キーゲート(rankBgColor && rankBgOpacity && textColor)を
// 満たさない場合は false を返し、呼び出し側で loadSavedSettings() へフォールバックする。
export function applyUrlColorParams(urlParams) {
    const values = {};
    COLOR_SETTINGS.forEach(entry => {
        values[entry.param] = {
            color: urlParams.get(entry.param),
            opacity: entry.opacityParam ? urlParams.get(entry.opacityParam) : null
        };
    });

    const rank = values.rankBgColor;
    const text = values.textColor;

    if (!(rank.color && rank.opacity && text.color)) {
        return false;
    }

    COLOR_SETTINGS.forEach(entry => {
        const v = values[entry.param];
        const hasPair = entry.opacityParam ? (v.color && v.opacity) : !!v.color;
        if (hasPair) {
            document.documentElement.style.setProperty(entry.cssVar, cssValue(entry, v.color, v.opacity));
        }
    });

    return true;
}

// カラーピッカー・URL生成関連のUIイベント配線
export function initSettingsUI() {
    // 8色設定のうち不透明度スライダーを持つものだけ input リスナーを登録
    COLOR_SETTINGS.forEach(entry => {
        if (!entry.sliderId) return;
        document.getElementById(entry.sliderId).addEventListener('input', function (e) {
            document.getElementById(entry.valueId).textContent = e.target.value + '%';
        });
    });

    // カラーピッカーモーダルのボタン
    document.getElementById('applyColorsButton').addEventListener('click', applyCustomColors);
    document.getElementById('cancelColorsButton').addEventListener('click', closeColorPicker);
    document.getElementById('resetColorsButton').addEventListener('click', resetCustomColors);

    // URL生成・コピー
    document.getElementById('generateUrlButton').addEventListener('click', generateURL);
    document.getElementById('copyUrlButton').addEventListener('click', copyURL);

    // カスタマイズボタンのイベントリスナーを設定
    const customizeButton = document.getElementById('customizeButton');
    if (customizeButton) {
        customizeButton.addEventListener('click', showColorPicker);
    }

    // テーマボタンのイベントリスナーを設定
    document.querySelectorAll('.theme-button').forEach(button => {
        button.addEventListener('click', function () {
            const theme = this.getAttribute('data-theme');
            applyTheme(theme);
            // テーマ変更後に幅調整（プレビュー画面のみ）
            setTimeout(() => {
                if (theme === 'classic') {
                    resetLastMatchWidthForClassic();
                } else {
                    adjustLastMatchWidth();
                }
            }, 300);
        });
    });

    // モーダルの外側をクリックしたら閉じる
    window.addEventListener('click', function (event) {
        const modal = document.getElementById('colorPickerModal');
        if (event.target == modal) {
            closeColorPicker();
        }
    });
}
