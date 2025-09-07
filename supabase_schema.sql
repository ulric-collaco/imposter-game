-- Supabase schema for Imposter Game

-- players table: one row per player in the universal room
create table if not exists players (
  id uuid primary key,
  name text,
  avatar_url text,
  ready boolean default false,
  status text default 'alive',
  joined_at timestamptz default now(),
  last_seen timestamptz default now()
);

-- single-row game state table; id=1 used as the universal game
create table if not exists game_state (
  id int primary key default 1,
  state text default 'waiting', -- waiting, question, answers, discussion, voting, results
  phase_started_at timestamptz,
  imposter uuid,
  question_id int,
  discussion_ends_at timestamptz,
  voting_ends_at timestamptz
);

-- store per-player role/assigned question or hint (assigned_text used for immediate display)
create table if not exists player_roles (
  player_id uuid references players(id) on delete cascade,
  role text,
  assigned_text text,
  assigned_question_id int,
  primary key(player_id)
);

-- allow storing results as json
alter table game_state add column if not exists results jsonb;

-- questions table
create table if not exists questions (
  id serial primary key,
  prompt text not null,
  related_prompt text
);

-- answers table
create table if not exists answers (
  id serial primary key,
  player_id uuid references players(id) on delete cascade,
  question_id int references questions(id),
  answer text,
  created_at timestamptz default now()
);

-- votes table
create table if not exists votes (
  id serial primary key,
  voter uuid references players(id) on delete cascade,
  target uuid references players(id) on delete cascade,
  created_at timestamptz default now()
);

-- simple indexes
create index if not exists idx_players_joined_at on players(joined_at);
create index if not exists idx_players_last_seen on players(last_seen);

-- Add last_seen column if it doesn't exist (for existing databases)
alter table players add column if not exists last_seen timestamptz default now();

-- sample data
insert into questions (prompt, related_prompt) values
('Name a use for string besides tying things.', 'A word-related prompt about materials'),
('What is the capital of France?', 'A European capital question');
