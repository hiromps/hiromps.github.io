// マッチ詳細データの加工層 (ES Module)
import { RANK_FILES, rankImageUrl } from '../../shared/ranks.js';

// 試合の開始時刻をミリ秒のUNIXタイムスタンプで返す。HenrikDev APIはバージョンにより
// フィールド名が異なるため、存在する候補を順に試す。どれも取得できない場合は0を返し、
// (元の取得順を保った上で)並び替えの末尾に安定して収まるようにする。
function getMatchTimestamp(match) {
    const meta = match && match.metadata;
    if (!meta) return 0;

    if (typeof meta.started_at === 'string') {
        const t = Date.parse(meta.started_at);
        if (!isNaN(t)) return t;
    }
    if (typeof meta.game_start === 'number') {
        // 秒単位のUNIXタイムスタンプ(HenrikDev v1〜v3系でよく使われる形式)
        return meta.game_start * 1000;
    }
    if (typeof meta.game_start_patched === 'string') {
        const t = Date.parse(meta.game_start_patched);
        if (!isNaN(t)) return t;
    }
    return 0;
}

// 一覧表示用に日付を "YYYY/MM/DD" 形式へ整形する。タイムスタンプが取得できない試合は
// "不明" と表示する(ソート用の 0 をそのまま日付として見せないため)。
function formatMatchDate(timestampMs) {
    if (!timestampMs) return '不明';
    const d = new Date(timestampMs);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}/${m}/${day}`;
}

// 試合中の「自分」を特定する。puuid照合を先に行い、失敗したときだけ name/tag 照合
// (小文字化して比較)に落とす。
//
// Worker のマッチ系ルート(/riot/match)は変換に失敗した試合だけを HenrikDev へ
// フォールバックする(X-Match-Source: henrik-fallback)ため、1回の検索の中で
// Riot体系のpuuid(78文字)と Henrik体系のpuuid(36文字UUID)が混在しうる。
// puuid照合だけだと一致しない試合が「自分が見つからない」として静かに除外され、
// 全試合がフォールバックした場合は表示が0件になる(逆に、アカウント解決だけが
// Henrikへフォールバックした場合も同じ事故が起きる)。
//
// puuidを先に見るのは、リネーム済みプレイヤーの過去試合には試合当時の名前が
// 記録されており、name/tag照合が偽陰性になりうるため(puuidはリネームで変わらない)。
function findSelfPlayer(players, puuid, gameName, tagLine) {
    const byPuuid = players.find(p => p.puuid === puuid);
    if (byPuuid) return byPuuid;

    if (!gameName || !tagLine) return null;
    const name = String(gameName).toLowerCase();
    const tag = String(tagLine).toLowerCase();
    return players.find(p =>
        typeof p.name === 'string' && typeof p.tag === 'string' &&
        p.name.toLowerCase() === name && p.tag.toLowerCase() === tag
    ) || null;
}

// --- DATA PROCESSING ---
// seasonScope: 'current'(デフォルト、今シーズンのみ) | 'all'(全シーズン/通期をそのまま表示)
// 「今シーズン」は取得できた試合のうち最も新しいものの season.short を基準にする。
// (MMRデータの by_season から「現行アクト」を推測する方式を試したことがあるが、
// まだ実試合が無い先のアクトを指すことがあり、直近の実試合まで除外してしまう
// 不具合が起きたため廃止した。取得できた試合そのものの情報を信頼する方が確実。)
// gameName / tagLine は自己特定のフォールバック用(findSelfPlayer 参照)。
// 省略した場合は puuid 照合のみになる。
export function processMatchData(matches, puuid, seasonScope = 'current', gameName = null, tagLine = null) {

    if (!matches || matches.length === 0) {
        return [];
    }

    // API側が返す順序を信用せず、必ず「最新の試合が先頭」になるようクライアント側で
    // 明示的に並び替える。ここが崩れていると、直後のシーズン判定(先頭の試合を基準に
    // 現在シーズンを決める)が誤ったシーズンを掴んでしまい、本来は今シーズンの試合が
    // 丸ごと除外される(=表示件数が不自然に少なくなる)ことがある。
    const sortedMatches = [...matches].sort((a, b) => getMatchTimestamp(b) - getMatchTimestamp(a));

    // 「今シーズンのみ」の場合だけ、対象シーズンの short コードを確定してフィルタする。
    // 「全シーズン」選択時はシーズンによる絞り込みを行わず、取得できた試合をそのまま使う。
    let targetSeasonShort = null;
    if (seasonScope !== 'all') {
        // 直近の試合(=最新のもの、上でソート済み)のシーズンを「今シーズン」とみなす。
        for (const match of sortedMatches) {
            if (match && match.metadata && match.metadata.season && match.metadata.season.short) {
                targetSeasonShort = match.metadata.season.short;
                break;
            }
        }

        if (!targetSeasonShort) {
            console.warn("Could not determine current season from fetched matches. Displaying all fetched competitive matches.");
            // シーズンが特定できない場合は、取得した全コンペ試合をそのまま処理 (従来通りのフォールバック)
        } else {
            console.log("Determined current season from most recent match:", targetSeasonShort);
        }
    }

    const processedMatches = sortedMatches.map(match => {

        if (!match || !match.metadata || !match.players || !match.teams || !match.rounds) {
            console.warn("Skipping match due to missing fundamental data structure (metadata, players, teams, or rounds):", match);
            return null;
        }

        const matchSeasonShort = match.metadata.season ? match.metadata.season.short : null;

        // ★ 変更: シーズンによるフィルタリング (targetSeasonShortが特定できた場合のみ。全シーズン選択時はスキップ)
        if (targetSeasonShort && matchSeasonShort !== targetSeasonShort) {
            console.log(`Skipping match from different season: match season=${matchSeasonShort || 'N/A'}, target season=${targetSeasonShort}`);
            return null;
        }

        // ★ 追加: ゲームモードがコンペティティブであるかを確認 (これは残す)
        if (!match.metadata.queue || (match.metadata.queue.id !== 'competitive' && match.metadata.queue.name !== 'Competitive')) {
            console.log(`Skipping non-competitive match: queue.id=${match.metadata.queue.id}, queue.name=${match.metadata.queue.name}`);
            return null;
        }

        const player = findSelfPlayer(match.players, puuid, gameName, tagLine);

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
            matchDate: formatMatchDate(getMatchTimestamp(match)),
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
            seasonShort: matchSeasonShort,
            damageDealt: damageDealtValue, // 与ダメージ
            damageReceived: damageReceivedValue, // 被ダメージ
            roundsPlayed: roundsPlayed // ラウンド数
        };
    }).filter(Boolean);

    return processedMatches;
}
