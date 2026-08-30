create extension if not exists pgcrypto;

create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  client_token uuid not null,
  status text not null default 'awaiting_upload'
    check (status in ('awaiting_upload', 'processing', 'completed', 'completed_with_warnings', 'failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  exam_name text not null,
  original_filename text not null,
  file_path text not null,
  key_path text,
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists analysis_jobs_created_at_idx
  on public.analysis_jobs (created_at desc);

alter table public.analysis_jobs enable row level security;
revoke all on public.analysis_jobs from anon, authenticated;

create or replace function public.set_analysis_jobs_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists analysis_jobs_updated_at on public.analysis_jobs;
create trigger analysis_jobs_updated_at
before update on public.analysis_jobs
for each row execute function public.set_analysis_jobs_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ydt-uploads',
  'ydt-uploads',
  false,
  52428800,
  array[
    'application/pdf',
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No public table or storage policies are created. Netlify uses the service-role
-- key, while the browser receives short-lived, path-specific upload tokens.
