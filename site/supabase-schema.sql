create table if not exists public.coach_requests (
  id text primary key,
  status text not null default 'pending',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  admin_note text not null default '',
  payload jsonb not null
);

create index if not exists coach_requests_submitted_at_idx
  on public.coach_requests (submitted_at desc);
