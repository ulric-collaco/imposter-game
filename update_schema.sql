-- Add last_seen column for player heartbeat tracking
ALTER TABLE players ADD COLUMN IF NOT EXISTS last_seen timestamptz DEFAULT now();

-- Update existing players with current timestamp
UPDATE players SET last_seen = now() WHERE last_seen IS NULL;

-- Create index for better performance on cleanup queries
CREATE INDEX IF NOT EXISTS idx_players_last_seen ON players(last_seen);
