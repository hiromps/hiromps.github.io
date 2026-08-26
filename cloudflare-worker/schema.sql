-- Riot自前RR追跡用スキーマ (D1)
--
-- KVは1日1,000書き込み/アカウント全体という制約(2026-08-25に上限超過アラート済み)があるため、
-- RR系のデータはKVではなくD1に置く。D1の無料枠は書き込み10万行/日・読み取り500万行/日で、
-- KVとは別枠かつ2桁大きい。
--
-- 適用: wrangler d1 execute valorant-rr --file=schema.sql --remote

-- 現在のRRスナップショット(1プレイヤー1行)。
-- player_key は Riot ACCOUNT-V1 の puuid(78文字・暗号化形式)をそのまま使う。
-- 実測でリーダーボードの puuid と ACCOUNT-V1 の puuid が完全一致することを確認済み
-- (Murphyslaw#3b1 で照合)。改名に強いので name#tag より優先する。
CREATE TABLE IF NOT EXISTS rr_current (
  player_key       TEXT PRIMARY KEY,   -- Riot puuid
  region            TEXT NOT NULL,
  name              TEXT NOT NULL,     -- 表示用。改名で古くなりうるが取得のたびに更新する
  tag               TEXT NOT NULL,
  tier              INTEGER NOT NULL,
  rr                INTEGER NOT NULL,
  last_change       INTEGER,           -- 直近に検出した試合でのRR増減(mmr_change_to_last_game の元)。
                                        -- 新しい試合を検出した時だけ更新し、変化なしのポーリングでは
                                        -- 前回値をそのまま返す(「試合していないのに0pts」という誤表示を防ぐ)
  leaderboard_rank  INTEGER,           -- 次回探索を1リクエストに縮めるヒント
  source            TEXT NOT NULL,     -- 'riot' | 'henrik'
  observed_at       INTEGER NOT NULL   -- epoch ms
);

-- 試合ごとのRR変動(mmr-history 互換レスポンスの素)。
CREATE TABLE IF NOT EXISTS rr_history (
  player_key  TEXT NOT NULL,
  match_id    TEXT NOT NULL,
  tier        INTEGER NOT NULL,
  rr          INTEGER NOT NULL,        -- 試合後のRR (= ranking_in_tier)
  rr_change   INTEGER,                 -- 直前の観測との差分。基準がなければ NULL
  observed_at INTEGER NOT NULL,
  source      TEXT NOT NULL,           -- 'observed' | 'henrik-seed'
  PRIMARY KEY (player_key, match_id)
);

CREATE INDEX IF NOT EXISTS idx_rr_history_player_time
  ON rr_history(player_key, observed_at DESC);
