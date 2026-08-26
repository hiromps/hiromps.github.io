const config = {
    // Cloudflare Workerプロキシ経由でHenrikDev APIを呼び出す。
    // 実際のAPIキーはWorker側のsecret(HENRIKDEV_API_KEY)としてのみ保持し、
    // クライアントには一切渡さない。
    API_BASE_URL: 'https://hiromps-valorant-proxy.akihiro19970324.workers.dev/valorant',
    // Riot公式API経路(同じWorker)。リーダーボードはこちらを使う。
    // キーはWorker側のsecret(RIOT_API_KEY)のみ。Riot側が失敗した場合は
    // Worker内部でHenrikDev v3に自動フォールバックする。
    RIOT_API_BASE_URL: 'https://hiromps-valorant-proxy.akihiro19970324.workers.dev/riot'
};
