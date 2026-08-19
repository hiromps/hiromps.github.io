// カラーカスタマイズ・URL生成層 (ES Module)
// NOTE: hexToRgba の重複解消とデータ駆動化(COLOR_SETTINGS)は C7 で行う。ここでは挙動を変えず移設のみ。
import { state } from './state.js';
import { applyTheme } from './theme.js';
import { resetLastMatchWidthForClassic, adjustLastMatchWidth } from './layout.js';

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
    const rankBgColor = document.getElementById('rankBgColorPicker').value;
    const rankBgOpacity = document.getElementById('rankBgOpacitySlider').value;
    const lastMatchBgColor = document.getElementById('lastMatchBgColorPicker').value;
    const lastMatchBgOpacity = document.getElementById('lastMatchBgOpacitySlider').value;
    const textColor = document.getElementById('textColorPicker').value;
    const rrColor = document.getElementById('rrColorPicker').value;
    const borderColor = document.getElementById('borderColorPicker').value;
    const borderOpacity = document.getElementById('borderOpacitySlider').value;

    // ランク背景色をrgba形式に変換
    const rankR = parseInt(rankBgColor.slice(1, 3), 16);
    const rankG = parseInt(rankBgColor.slice(3, 5), 16);
    const rankB = parseInt(rankBgColor.slice(5, 7), 16);
    const rgbaRankBgColor = `rgba(${rankR}, ${rankG}, ${rankB}, ${rankBgOpacity / 100})`;

    // 前回のマッチ背景色をrgba形式に変換
    const lastMatchR = parseInt(lastMatchBgColor.slice(1, 3), 16);
    const lastMatchG = parseInt(lastMatchBgColor.slice(3, 5), 16);
    const lastMatchB = parseInt(lastMatchBgColor.slice(5, 7), 16);
    const rgbaLastMatchBgColor = `rgba(${lastMatchR}, ${lastMatchG}, ${lastMatchB}, ${lastMatchBgOpacity / 100})`;

    // 境界線色をrgba形式に変換
    const borderR = parseInt(borderColor.slice(1, 3), 16);
    const borderG = parseInt(borderColor.slice(3, 5), 16);
    const borderB = parseInt(borderColor.slice(5, 7), 16);
    const rgbaBorderColor = `rgba(${borderR}, ${borderG}, ${borderB}, ${borderOpacity / 100})`;

    // CSS変数を更新
    document.documentElement.style.setProperty('--rank-bg-color', rgbaRankBgColor);
    document.documentElement.style.setProperty('--last-match-bg-color', rgbaLastMatchBgColor);
    document.documentElement.style.setProperty('--text-color', textColor);
    document.documentElement.style.setProperty('--rr-color', rrColor);
    document.documentElement.style.setProperty('--border-color', rgbaBorderColor);

    // 設定を保存
    localStorage.setItem('customRankBgColor', rankBgColor);
    localStorage.setItem('customRankBgOpacity', rankBgOpacity);
    localStorage.setItem('customLastMatchBgColor', lastMatchBgColor);
    localStorage.setItem('customLastMatchBgOpacity', lastMatchBgOpacity);
    localStorage.setItem('customTextColor', textColor);
    localStorage.setItem('customRrColor', rrColor);
    localStorage.setItem('customBorderColor', borderColor);
    localStorage.setItem('customBorderOpacity', borderOpacity);

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
    // デフォルト値に戻す
    document.getElementById('rankBgColorPicker').value = '#3a444e';
    document.getElementById('rankBgOpacitySlider').value = '100';
    document.getElementById('rankBgOpacityValue').textContent = '100%';
    document.getElementById('lastMatchBgColorPicker').value = '#F44336';
    document.getElementById('lastMatchBgOpacitySlider').value = '100';
    document.getElementById('lastMatchBgOpacityValue').textContent = '100%';
    document.getElementById('textColorPicker').value = '#ffffff';
    document.getElementById('rrColorPicker').value = '#ff4655';
    document.getElementById('borderColorPicker').value = '#ff4655';
    document.getElementById('borderOpacitySlider').value = '100';
    document.getElementById('borderOpacityValue').textContent = '100%';

    // CSS変数をリセット
    document.documentElement.style.setProperty('--rank-bg-color', 'rgba(58, 68, 78, 1)');
    document.documentElement.style.setProperty('--last-match-bg-color', 'rgba(244, 67, 54, 1)');
    document.documentElement.style.setProperty('--text-color', '#ffffff');
    document.documentElement.style.setProperty('--rr-color', '#ff4655');
    document.documentElement.style.setProperty('--border-color', 'rgba(255, 70, 85, 1)');

    // localStorageからカスタム設定を削除
    localStorage.removeItem('customRankBgColor');
    localStorage.removeItem('customRankBgOpacity');
    localStorage.removeItem('customLastMatchBgColor');
    localStorage.removeItem('customLastMatchBgOpacity');
    localStorage.removeItem('customTextColor');
    localStorage.removeItem('customRrColor');
    localStorage.removeItem('customBorderColor');
    localStorage.removeItem('customBorderOpacity');

    // テーマをクラシックに戻す
    applyTheme('classic');

    // リセット後に幅調整を実行（プレビュー画面のみ）
    setTimeout(() => {
        // リセット後はクラシックテーマになるので、クラシック用の処理を実行
        resetLastMatchWidthForClassic();
    }, 300);
}

// 保存された設定を読み込む
export function loadSavedSettings() {
    const savedRankBgColor = localStorage.getItem('customRankBgColor');
    const savedRankBgOpacity = localStorage.getItem('customRankBgOpacity');
    const savedLastMatchBgColor = localStorage.getItem('customLastMatchBgColor');
    const savedLastMatchBgOpacity = localStorage.getItem('customLastMatchBgOpacity');
    const savedTextColor = localStorage.getItem('customTextColor');
    const savedRrColor = localStorage.getItem('customRrColor');
    const savedBorderColor = localStorage.getItem('customBorderColor');
    const savedBorderOpacity = localStorage.getItem('customBorderOpacity');
    const savedTheme = localStorage.getItem('selectedTheme');

    if (savedRankBgColor && savedRankBgOpacity && savedTextColor) {
        // ランク背景色の設定
        const rankR = parseInt(savedRankBgColor.slice(1, 3), 16);
        const rankG = parseInt(savedRankBgColor.slice(3, 5), 16);
        const rankB = parseInt(savedRankBgColor.slice(5, 7), 16);
        const rgbaRankBgColor = `rgba(${rankR}, ${rankG}, ${rankB}, ${savedRankBgOpacity / 100})`;

        // 前回のマッチ背景色の設定
        if (savedLastMatchBgColor && savedLastMatchBgOpacity) {
            const lastMatchR = parseInt(savedLastMatchBgColor.slice(1, 3), 16);
            const lastMatchG = parseInt(savedLastMatchBgColor.slice(3, 5), 16);
            const lastMatchB = parseInt(savedLastMatchBgColor.slice(5, 7), 16);
            const rgbaLastMatchBgColor = `rgba(${lastMatchR}, ${lastMatchG}, ${lastMatchB}, ${savedLastMatchBgOpacity / 100})`;
            document.documentElement.style.setProperty('--last-match-bg-color', rgbaLastMatchBgColor);
        }

        // 境界線色の設定
        if (savedBorderColor && savedBorderOpacity) {
            const borderR = parseInt(savedBorderColor.slice(1, 3), 16);
            const borderG = parseInt(savedBorderColor.slice(3, 5), 16);
            const borderB = parseInt(savedBorderColor.slice(5, 7), 16);
            const rgbaBorderColor = `rgba(${borderR}, ${borderG}, ${borderB}, ${savedBorderOpacity / 100})`;
            document.documentElement.style.setProperty('--border-color', rgbaBorderColor);
        }

        document.documentElement.style.setProperty('--rank-bg-color', rgbaRankBgColor);
        document.documentElement.style.setProperty('--text-color', savedTextColor);
        if (savedRrColor) {
            document.documentElement.style.setProperty('--rr-color', savedRrColor);
        }

        // カラーピッカーの値を更新
        document.getElementById('rankBgColorPicker').value = savedRankBgColor;
        document.getElementById('rankBgOpacitySlider').value = savedRankBgOpacity;
        document.getElementById('rankBgOpacityValue').textContent = savedRankBgOpacity + '%';
        if (savedLastMatchBgColor && savedLastMatchBgOpacity) {
            document.getElementById('lastMatchBgColorPicker').value = savedLastMatchBgColor;
            document.getElementById('lastMatchBgOpacitySlider').value = savedLastMatchBgOpacity;
            document.getElementById('lastMatchBgOpacityValue').textContent = savedLastMatchBgOpacity + '%';
        }
        document.getElementById('textColorPicker').value = savedTextColor;
        if (savedRrColor) {
            document.getElementById('rrColorPicker').value = savedRrColor;
        }
        if (savedBorderColor) {
            document.getElementById('borderColorPicker').value = savedBorderColor;
        }
        if (savedBorderOpacity) {
            document.getElementById('borderOpacitySlider').value = savedBorderOpacity;
            document.getElementById('borderOpacityValue').textContent = savedBorderOpacity + '%';
        }
    }

    // テーマ設定を適用
    if (savedTheme) {
        applyTheme(savedTheme);
    }
}

export function generateURL() {
    const playerName = document.getElementById('playerName').value;
    const playerTag = document.getElementById('playerTag').value;

    if (!playerName || !playerTag) {
        alert('プレイヤー名とタグを入力してください。');
        return;
    }

    const currentURL = window.location.href.split('?')[0];
    const urlParams = new URLSearchParams();
    urlParams.append('name', playerName);
    urlParams.append('tag', playerTag);
    urlParams.append('obs', ''); // OBSモードパラメータをデフォルトで追加
    urlParams.append('updateInterval', '30'); // 自動更新間隔（30秒）に短縮

    // カスタマイズ設定をURLパラメータとして追加
    const savedRankBgColor = localStorage.getItem('customRankBgColor');
    const savedRankBgOpacity = localStorage.getItem('customRankBgOpacity');
    const savedLastMatchBgColor = localStorage.getItem('customLastMatchBgColor');
    const savedLastMatchBgOpacity = localStorage.getItem('customLastMatchBgOpacity');
    const savedTextColor = localStorage.getItem('customTextColor');
    const savedRrColor = localStorage.getItem('customRrColor');
    const savedBorderColor = localStorage.getItem('customBorderColor');
    const savedBorderOpacity = localStorage.getItem('customBorderOpacity');
    const savedTheme = localStorage.getItem('selectedTheme');

    if (savedRankBgColor) urlParams.append('rankBgColor', savedRankBgColor);
    if (savedRankBgOpacity) urlParams.append('rankBgOpacity', savedRankBgOpacity);
    if (savedLastMatchBgColor) urlParams.append('lastMatchBgColor', savedLastMatchBgColor);
    if (savedLastMatchBgOpacity) urlParams.append('lastMatchBgOpacity', savedLastMatchBgOpacity);
    if (savedTextColor) urlParams.append('textColor', savedTextColor);
    if (savedRrColor) urlParams.append('rrColor', savedRrColor);
    if (savedBorderColor) urlParams.append('borderColor', savedBorderColor);
    if (savedBorderOpacity) urlParams.append('borderOpacity', savedBorderOpacity);
    if (savedTheme) urlParams.append('theme', savedTheme);

    const newURL = `${currentURL}?${urlParams.toString()}`;
    document.getElementById('generatedURL').value = newURL;
}

export function copyURL() {
    const urlInput = document.getElementById('generatedURL');
    urlInput.select();
    document.execCommand('copy');
    alert('URLをコピーしました！');
}

// URLパラメータから色設定を適用する。3キーゲート(rankBgColor && rankBgOpacity && textColor)を
// 満たさない場合は false を返し、呼び出し側で loadSavedSettings() へフォールバックする。
export function applyUrlColorParams(urlParams) {
    const urlRankBgColor = urlParams.get('rankBgColor');
    const urlRankBgOpacity = urlParams.get('rankBgOpacity');
    const urlLastMatchBgColor = urlParams.get('lastMatchBgColor');
    const urlLastMatchBgOpacity = urlParams.get('lastMatchBgOpacity');
    const urlTextColor = urlParams.get('textColor');
    const urlRrColor = urlParams.get('rrColor');
    const urlBorderColor = urlParams.get('borderColor');
    const urlBorderOpacity = urlParams.get('borderOpacity');

    if (!(urlRankBgColor && urlRankBgOpacity && urlTextColor)) {
        return false;
    }

    const rankR = parseInt(urlRankBgColor.slice(1, 3), 16);
    const rankG = parseInt(urlRankBgColor.slice(3, 5), 16);
    const rankB = parseInt(urlRankBgColor.slice(5, 7), 16);
    const rgbaRankBgColor = `rgba(${rankR}, ${rankG}, ${rankB}, ${urlRankBgOpacity / 100})`;
    document.documentElement.style.setProperty('--rank-bg-color', rgbaRankBgColor);
    document.documentElement.style.setProperty('--text-color', urlTextColor);

    if (urlLastMatchBgColor && urlLastMatchBgOpacity) {
        const lastMatchR = parseInt(urlLastMatchBgColor.slice(1, 3), 16);
        const lastMatchG = parseInt(urlLastMatchBgColor.slice(3, 5), 16);
        const lastMatchB = parseInt(urlLastMatchBgColor.slice(5, 7), 16);
        const rgbaLastMatchBgColor = `rgba(${lastMatchR}, ${lastMatchG}, ${lastMatchB}, ${urlLastMatchBgOpacity / 100})`;
        document.documentElement.style.setProperty('--last-match-bg-color', rgbaLastMatchBgColor);
    }

    if (urlRrColor) {
        document.documentElement.style.setProperty('--rr-color', urlRrColor);
    }

    if (urlBorderColor && urlBorderOpacity) {
        const borderR = parseInt(urlBorderColor.slice(1, 3), 16);
        const borderG = parseInt(urlBorderColor.slice(3, 5), 16);
        const borderB = parseInt(urlBorderColor.slice(5, 7), 16);
        const rgbaBorderColor = `rgba(${borderR}, ${borderG}, ${borderB}, ${urlBorderOpacity / 100})`;
        document.documentElement.style.setProperty('--border-color', rgbaBorderColor);
    }

    return true;
}

// カラーピッカー・URL生成関連のUIイベント配線
export function initSettingsUI() {
    // ランク背景色の透明度スライダーの更新
    document.getElementById('rankBgOpacitySlider').addEventListener('input', function (e) {
        document.getElementById('rankBgOpacityValue').textContent = e.target.value + '%';
    });

    // 前回のマッチ背景色の透明度スライダーの更新
    document.getElementById('lastMatchBgOpacitySlider').addEventListener('input', function (e) {
        document.getElementById('lastMatchBgOpacityValue').textContent = e.target.value + '%';
    });

    // 境界線色の透明度スライダーの更新
    document.getElementById('borderOpacitySlider').addEventListener('input', function (e) {
        document.getElementById('borderOpacityValue').textContent = e.target.value + '%';
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
