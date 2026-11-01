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

-- Solo impronte SHA-256 dei codici di caricamento e del gruppo, mai i codici in chiaro.
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
