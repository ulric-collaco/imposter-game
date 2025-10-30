-- Complete database schema for the game
-- Run this in your Supabase SQL editor

-- Create players table (TEXT id to support client-generated ids)
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  room_code TEXT NOT NULL,
  device_id TEXT,
  email TEXT,
  ready BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  last_seen TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  joined_at TIMESTAMPTZ
);

-- Create games table (one row per room)
CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  room_code TEXT UNIQUE,
  phase TEXT DEFAULT 'waiting',
  player_count INTEGER DEFAULT 0,
  question_id INTEGER,
  imposter_id TEXT,
  discussion_ends_at TIMESTAMPTZ,
  results JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create votes table (scoped by room)
CREATE TABLE IF NOT EXISTS votes (
  id SERIAL PRIMARY KEY,
  room_code TEXT NOT NULL,
  player_id TEXT,
  target_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Optional: deprecated, kept for compatibility
CREATE TABLE IF NOT EXISTS game_state (
  id SERIAL PRIMARY KEY,
  phase TEXT DEFAULT 'waiting',
  question_id INTEGER,
  imposter_id TEXT,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  room_code TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create answers table
CREATE TABLE IF NOT EXISTS answers (
  id SERIAL PRIMARY KEY,
  room_code TEXT NOT NULL,
  player_id TEXT,
  answer TEXT NOT NULL,
  question_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_players_is_active ON players(is_active);
CREATE INDEX IF NOT EXISTS idx_players_last_seen ON players(last_seen);
CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_code);
CREATE INDEX IF NOT EXISTS idx_players_device ON players(device_id);
CREATE INDEX IF NOT EXISTS idx_games_room ON games(room_code);
CREATE INDEX IF NOT EXISTS idx_games_phase ON games(phase);
CREATE INDEX IF NOT EXISTS idx_votes_room ON votes(room_code);
CREATE INDEX IF NOT EXISTS idx_votes_player_id ON votes(player_id);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_code);
CREATE INDEX IF NOT EXISTS idx_answers_room ON answers(room_code);
-- Create index for active players in rooms
CREATE INDEX IF NOT EXISTS idx_players_room_active ON players(room_code, is_active) WHERE is_active = true;
-- Create unique index to ensure one active player per device per room
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_device_room_active 
  ON players(room_code, device_id) WHERE is_active = true;

-- Enable Row Level Security (RLS)
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_state ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Players can view players by room" ON players;
DROP POLICY IF EXISTS "Players can upsert themselves" ON players;
DROP POLICY IF EXISTS "Players can update themselves" ON players;
DROP POLICY IF EXISTS "Players can delete themselves" ON players;
DROP POLICY IF EXISTS "Anyone can view games" ON games;
DROP POLICY IF EXISTS "Anyone can upsert games" ON games;
DROP POLICY IF EXISTS "Anyone can update games" ON games;
DROP POLICY IF EXISTS "Anyone can delete games" ON games;
DROP POLICY IF EXISTS "Anyone can view votes" ON votes;
DROP POLICY IF EXISTS "Anyone can insert votes" ON votes;
DROP POLICY IF EXISTS "Anyone can delete votes" ON votes;
DROP POLICY IF EXISTS "Anyone can view messages" ON messages;
DROP POLICY IF EXISTS "Anyone can insert messages" ON messages;
DROP POLICY IF EXISTS "Anyone can delete messages" ON messages;
DROP POLICY IF EXISTS "Anyone can view answers" ON answers;
DROP POLICY IF EXISTS "Anyone can insert answers" ON answers;
DROP POLICY IF EXISTS "Anyone can delete answers" ON answers;
DROP POLICY IF EXISTS "Anyone can view game_state" ON game_state;
DROP POLICY IF EXISTS "Anyone can insert game_state" ON game_state;
DROP POLICY IF EXISTS "Anyone can update game_state" ON game_state;

-- Create policies for players table
CREATE POLICY "Players can view players by room" ON players
  FOR SELECT USING (true);

CREATE POLICY "Players can upsert themselves" ON players
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Players can update themselves" ON players
  FOR UPDATE USING (true);

CREATE POLICY "Players can delete themselves" ON players
  FOR DELETE USING (true);

-- Create policies for games table
CREATE POLICY "Anyone can view games" ON games FOR SELECT USING (true);
CREATE POLICY "Anyone can upsert games" ON games FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update games" ON games FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete games" ON games FOR DELETE USING (true);

-- Create policies for votes table
CREATE POLICY "Anyone can view votes" ON votes FOR SELECT USING (true);
CREATE POLICY "Anyone can insert votes" ON votes FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete votes" ON votes FOR DELETE USING (true);

-- Messages policies
CREATE POLICY "Anyone can view messages" ON messages FOR SELECT USING (true);
CREATE POLICY "Anyone can insert messages" ON messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete messages" ON messages FOR DELETE USING (true);

-- Answers policies
CREATE POLICY "Anyone can view answers" ON answers FOR SELECT USING (true);
CREATE POLICY "Anyone can insert answers" ON answers FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete answers" ON answers FOR DELETE USING (true);

-- Create policies for game_state table
CREATE POLICY "Anyone can view game_state" ON game_state
  FOR SELECT USING (true);

CREATE POLICY "Anyone can insert game_state" ON game_state
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update game_state" ON game_state
  FOR UPDATE USING (true);

-- Run the migration
ALTER TABLE players ADD COLUMN IF NOT EXISTS device_id TEXT;
CREATE INDEX IF NOT EXISTS idx_players_device ON players(device_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_device_room_active 
  ON players(room_code, device_id) WHERE is_active = true;
ALTER TABLE games ADD COLUMN IF NOT EXISTS player_count INTEGER DEFAULT 0;

-- Update existing games with current counts
UPDATE games g
SET player_count = (
  SELECT COUNT(*) 
  FROM players p 
  WHERE p.room_code = g.room_code
);

-- No default records; games are per room
