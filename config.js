const config = {
    // Cloudflare Pages Functions のプロキシ経由でHenrikDev APIを呼び出す。
    // 実際のAPIキーはプロキシ側のsecret(HENRIKDEV_API_KEY)としてのみ保持し、
    // クライアントには一切渡さない。実装は cloudflare-worker/functions/[[path]].js。
    //
    // ホストが *.pages.dev なのは Cache API(エッジキャッシュ)を使うため。
    // Workers を *.workers.dev で動かすと Cache API が no-op になり、
    // キャッシュを全て Workers KV で賄うことになって書き込み上限(1日1,000回)を
    // 超過するため、Pages Functions に移行した。
    API_BASE_URL: 'https://valorant-proxy-d8j.pages.dev/valorant',
    // Riot公式API経路(同じプロキシ)。リーダーボードはこちらを使う。
    // キーはプロキシ側のsecret(RIOT_API_KEY)のみ。Riot側が失敗した場合は
    // プロキシ内部でHenrikDev v3に自動フォールバックする。
    RIOT_API_BASE_URL: 'https://valorant-proxy-d8j.pages.dev/riot'
};
