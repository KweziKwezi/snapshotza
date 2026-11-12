-- SnapshotZA · 0013 · Chats are deleted after 20 days
--
-- A message is deleted once it is older than platform_settings.chat_retention_days (20). Chats are kept while a
-- problem report on that booking is still being looked at, because they may be evidence; once the report is decided
-- they follow the normal 20-day rule. The Worker's daily job calls purge_old_chats(). Safe to run once, after 0012.

alter table public.platform_settings
  add column chat_retention_days int not null default 20 check (chat_retention_days between 1 and 365);

create function public.purge_old_chats() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_days int; v_n int;
begin
  select chat_retention_days into v_days from public.platform_settings;
  delete from public.chat_messages m
   where m.created_at < now() - make_interval(days => v_days)
     and not exists (select 1 from public.bookings b where b.id = m.booking_id and b.status = 'disputed')
     and not exists (select 1 from public.disputes d where d.booking_id = m.booking_id and d.status in ('open', 'investigating'));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.purge_old_chats() from public, anon, authenticated;
grant execute on function public.purge_old_chats() to service_role;
