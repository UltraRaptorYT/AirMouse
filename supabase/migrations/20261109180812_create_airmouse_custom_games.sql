create table public.airmouse_custom_games (
  id uuid primary key default gen_random_uuid(),
  creator_name text not null check (char_length(btrim(creator_name)) between 1 and 80),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  language text not null check (language in ('en', 'zh')),
  prompt text not null check (char_length(btrim(prompt)) between 1 and 8000),
  answers jsonb not null check (
    jsonb_typeof(answers) = 'array'
    and jsonb_array_length(answers) between 1 and 40
  ),
  instruction text not null default 'Drag each phrase into its place.'
    check (char_length(instruction) <= 240),
  created_at timestamptz not null default now()
);

alter table public.airmouse_custom_games enable row level security;

revoke all on table public.airmouse_custom_games from anon, authenticated;
grant all on table public.airmouse_custom_games to service_role;

create index airmouse_custom_games_created_at_idx
  on public.airmouse_custom_games (created_at desc);
