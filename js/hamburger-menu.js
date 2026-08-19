// ハンバーガーメニューの動作（完全統一版・全ページ共通）
// classic script として全ページから <script src="js/hamburger-menu.js"></script> で読み込む。
// index.html / valorant-stats-tracker は ES Modules を使うページだが、
// このファイル自体はモジュールではなく通常の script として読み込む(モジュール側に同名関数は置かない)。
// DOMContentLoaded でラップしているため、<head>/<body> どちらに置いても安全に動作する。
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

document.addEventListener('DOMContentLoaded', function () {
    initializeHamburgerMenu();
});
