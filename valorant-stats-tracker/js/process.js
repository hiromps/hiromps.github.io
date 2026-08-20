// マッチ詳細データの加工層 (ES Module)
import { RANK_FILES, rankImageUrl } from '../../shared/ranks.js';

// --- DATA PROCESSING ---
export function processMatchData(matches, puuid) {

    if (!matches || matches.length === 0) {
        return [];
    }

    // 最新の試合から現在のシーズンIDを特定
    let currentSeasonId = null;
    for (const match of matches) { // まず有効なシーズンIDを持つ最初のマッチを探す
        if (match && match.metadata && match.metadata.season && match.metadata.season.id) {
            currentSeasonId = match.metadata.season.id;
            break;
        }
    }

    if (!currentSeasonId) {
        console.warn("Could not determine current season ID from fetched matches. Displaying all fetched competitive matches.");
        // シーズンIDが特定できない場合は、取得した全コンペ試合をそのまま処理 (従来通りのフォールバック)
    } else {
        console.log("Determined current season ID:", currentSeasonId);
    }

    const processedMatches = matches.map(match => {

        if (!match || !match.metadata || !match.players || !match.teams || !match.rounds) {
            console.warn("Skipping match due to missing fundamental data structure (metadata, players, teams, or rounds):", match);
            return null;
        }

        // ★ 変更: シーズンIDによるフィルタリング (currentSeasonIdが特定できた場合のみ)
        if (currentSeasonId && (!match.metadata.season || match.metadata.season.id !== currentSeasonId)) {
            console.log(`Skipping match from different season: match season_id=${match.metadata.season ? match.metadata.season.id : 'N/A'}, current_season_id=${currentSeasonId}`);
            return null;
        }

        // ★ 追加: ゲームモードがコンペティティブであるかを確認 (これは残す)
        if (!match.metadata.queue || (match.metadata.queue.id !== 'competitive' && match.metadata.queue.name !== 'Competitive')) {
            console.log(`Skipping non-competitive match: queue.id=${match.metadata.queue.id}, queue.name=${match.metadata.queue.name}`);
            return null;
        }

        const player = match.players.find(p => p.puuid === puuid);

        if (!player || !player.stats || !player.agent) {
            console.warn("Player not found, or player missing stats/agent in match:", match, "for puuid:", puuid);
            return null;
        }

        const playerTeamData = match.teams.find(t => t.team_id.toLowerCase() === player.team_id.toLowerCase());

        if (!playerTeamData || typeof playerTeamData.won !== 'boolean' || !playerTeamData.rounds) {
             console.warn("Player team data not found or incomplete:", match, "for team_id:", player.team_id);
            return null;
        }
        const won = playerTeamData.won;
        const roundsWon = playerTeamData.rounds.won;
        const roundsLost = playerTeamData.rounds.lost;

        const totalShots = (player.stats.headshots || 0) + (player.stats.bodyshots || 0) + (player.stats.legshots || 0);
        const hsPercentage = totalShots > 0
            ? (((player.stats.headshots || 0) / totalShots) * 100).toFixed(1)
            : "0.0";

        const roundsPlayed = match.rounds.length;
        const acs = (roundsPlayed > 0 && player.stats && player.stats.score !== undefined)
            ? Math.round(player.stats.score / roundsPlayed)
            : 0;

        // KAST, Damage Dealt, Damage Received の取得試行
        const damageDealtValue = (player.stats.damage && typeof player.stats.damage.dealt === 'number') ? player.stats.damage.dealt : 0;
        const damageReceivedValue = (player.stats.damage && typeof player.stats.damage.received === 'number') ? player.stats.damage.received : 0;

        let agentIconUrl = 'https://placehold.co/32x32/1f2937/7f1d1d?text=?';
        if (player.agent && player.agent.name) {
            const rawAgentName = player.agent.name;
            const formattedAgentName = rawAgentName.toLowerCase().replace(/[^a-z0-9]/gi, '');
            // img.src への代入時にドキュメント基準(tracker/index.html)で解決されるため、
            // 元コードと同じくページ相対パスのままでよい(../ = リポジトリルート)
            agentIconUrl = `../assets/images/agents/${formattedAgentName}.png`;
        }

        let rankIconUrl = 'https://placehold.co/48x48/1f2937/7f1d1d?text=R';
        let apiRankName = player.tier && player.tier.name ? player.tier.name : "Unranked";
        let displayRankName = apiRankName; // This will be the name shown alongside the icon in the match row

        if (RANK_FILES[apiRankName]) {
            rankIconUrl = rankImageUrl(apiRankName);
        } else {
            // マッピングに失敗した場合はプレースホルダのまま表示する
            console.warn(`Match ${match.metadata.match_id} - Rank name "${apiRankName}" for player ${player.game_name} not found in RANK_FILES. Using placeholder.`);
        }

        const rankPoints = "-- RR"; // これは renderResults で MMR 履歴とマージして上書きされる

        return {
            matchId: match.metadata.match_id, // ★ renderResults で MMR 履歴と紐付けるために match_id を追加
            map: match.metadata.map ? match.metadata.map.name : '不明なマップ',
            agentName: player.agent.name || '不明なエージェント',
            agentIcon: agentIconUrl,
            result: won ? '勝利' : '敗北',
            resultBoolean: won, // 勝率計算用にbooleanも保持
            resultColor: won ? 'text-green-400' : 'text-red-400',
            score: `${roundsWon} - ${roundsLost}`,
            kills: player.stats.kills || 0, // K/D計算用に保持
            deaths: player.stats.deaths || 0, // K/D計算用に保持
            kda: `${player.stats.kills || 0} / ${player.stats.deaths || 0} / ${player.stats.assists || 0}`,
            kd: (player.stats.deaths === 0 ? (player.stats.kills || 0) : ((player.stats.kills || 0) / player.stats.deaths)).toFixed(2),
            hs: hsPercentage,
            acs: acs,
            rankName: displayRankName,
            rankIcon: rankIconUrl,
            rankPoints: rankPoints, // 初期値は "-- RR"
            seasonId: match.metadata.season ? match.metadata.season.id : null,
            damageDealt: damageDealtValue, // 与ダメージ
            damageReceived: damageReceivedValue, // 被ダメージ
            roundsPlayed: roundsPlayed // ラウンド数
        };
    }).filter(Boolean);

    return processedMatches;
}
