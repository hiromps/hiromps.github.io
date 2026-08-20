const config = {
    // Cloudflare Workerプロキシ経由でHenrikDev APIを呼び出す。
    // 実際のAPIキーはWorker側のsecret(HENRIKDEV_API_KEY)としてのみ保持し、
    // クライアントには一切渡さない。
    API_BASE_URL: 'https://hiromps-valorant-proxy.akihiro19970324.workers.dev/valorant'
};
