create table if not exists packs (
  id text primary key,
  title text not null,
  public jsonb not null,
  secret jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists pack_assets (
  pack_id text not null references packs(id) on delete cascade,
  asset_id text not null,
  mime text not null,
  data text not null,
  primary key (pack_id, asset_id)
);

create table if not exists games (
  code text primary key,
  pack_id text not null references packs(id),
  mode text not null check (mode in ('master', 'nomaster')),
  dealt boolean not null default false,
  step int not null default -1,
  version int not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists players (
  id text primary key,
  game_code text not null references games(code) on delete cascade,
  name text not null,
  name_key text not null,
  pin_hash text not null,
  token_hash text not null,
  role text not null check (role in ('player', 'master')),
  is_host boolean not null default false,
  cards int[] not null default '{}',
  ready_step int not null default -2,
  failed_pins int not null default 0,
  locked_until timestamptz,
  joined_at timestamptz not null default now(),
  unique (game_code, name_key)
);
create index if not exists players_token on players(token_hash);

create table if not exists votes (
  game_code text not null references games(code) on delete cascade,
  player_id text not null references players(id) on delete cascade,
  accused int,
  answers jsonb not null default '{}',
  award int,
  primary key (game_code, player_id)
);

create table if not exists score_marks (
  game_code text not null references games(code) on delete cascade,
  player_id text not null references players(id) on delete cascade,
  item text not null,
  primary key (game_code, player_id, item)
);

create table if not exists events (
  id bigserial primary key,
  game_code text not null references games(code) on delete cascade,
  at timestamptz not null default now(),
  text text not null
);

create table if not exists accounts (
  id text primary key,
  username text not null unique,
  password_hash text not null,
  recovery_hash text not null,
  failed_logins int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists account_sessions (
  token_hash text primary key,
  account_id text not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Solo quale cena e quando: mai personaggio, voti o soluzione.
create table if not exists account_dinners (
  account_id text not null references accounts(id) on delete cascade,
  pack_id text not null references packs(id) on delete cascade,
  role text not null check (role in ('player', 'master')),
  source text not null check (source in ('game', 'manual')),
  at timestamptz not null default now(),
  primary key (account_id, pack_id)
);

alter table players add column if not exists account_id text references accounts(id) on delete set null;
create unique index if not exists players_account on players(game_code, account_id) where account_id is not null;

alter table accounts enable row level security;
alter table account_sessions enable row level security;
alter table account_dinners enable row level security;

-- Solo l'impronta SHA-256 del codice di caricamento, mai il codice in chiaro.
create table if not exists app_settings (
  key text primary key,
  value text not null
);

-- Il telefono non parla mai col database: tutto passa dal server dell'app.
alter table app_settings enable row level security;
alter table packs enable row level security;
alter table pack_assets enable row level security;
alter table games enable row level security;
alter table players enable row level security;
alter table votes enable row level security;
alter table score_marks enable row level security;
alter table events enable row level security;
