-- SnapshotZA · 0012 · Chat between a client and their photographer
--
-- The table, privacy rules (only the two people on a paid booking, plus admins for disputes) and realtime already
-- exist. This adds: message checks and a flood limit, "unread" tracking, a notification when a message arrives,
-- and the conversation list. Safe to run once, after 0011.

---------------------------------------------------------------------------
-- Message checks: no empty or huge messages, and no flooding.
---------------------------------------------------------------------------
create function public.chat_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.message_type = 'system' then return new; end if;
  new.content := trim(coalesce(new.content, ''));
  if new.message_type = 'text' and new.content = '' then raise exception 'write a message first'; end if;
  if char_length(new.content) > 2000 then raise exception 'that message is too long (2000 characters at most)'; end if;
  if (select count(*) from public.chat_messages
       where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'you are sending messages too fast; please wait a moment';
  end if;
  return new;
end $$;
create trigger chat_guard before insert on public.chat_messages
  for each row execute function public.chat_guard();

---------------------------------------------------------------------------
-- Who has read what
---------------------------------------------------------------------------
create table public.chat_reads (
  booking_id   uuid not null references public.bookings (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (booking_id, user_id)
);
alter table public.chat_reads enable row level security;
create policy chat_reads_select on public.chat_reads for select to authenticated using (user_id = auth.uid());
revoke all on public.chat_reads from anon;
revoke insert, update, delete, truncate on public.chat_reads from authenticated;

-- "I have seen this conversation." Also clears the "new message" notifications for it.
create function public.mark_chat_read(p_booking uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_booking_party(p_booking) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.chat_reads (booking_id, user_id, last_read_at) values (p_booking, auth.uid(), now())
  on conflict (booking_id, user_id) do update set last_read_at = excluded.last_read_at;
  update public.notifications set read_at = now()
   where user_id = auth.uid() and booking_id = p_booking and type = 'chat_message' and read_at is null;
end $$;

---------------------------------------------------------------------------
-- Tell the other person (once, until they open the chat)
---------------------------------------------------------------------------
create function public.chat_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; v_pu uuid; v_to uuid; v_name text;
begin
  if new.message_type = 'system' then return null; end if;
  select * into b from public.bookings where id = new.booking_id;
  select user_id into v_pu from public.photographer_profiles where id = b.photographer_id;
  v_to := case when new.sender_id = b.client_id then v_pu else b.client_id end;
  if v_to is null or v_to = new.sender_id then return null; end if;
  if exists (select 1 from public.notifications where user_id = v_to and booking_id = b.id and type = 'chat_message' and read_at is null) then
    return null;                                                           -- already told; no pile-up
  end if;
  select split_part(coalesce(full_name, 'Someone'), ' ', 1) into v_name from public.profiles where id = new.sender_id;
  perform public.notify(v_to, 'chat_message', format('New message from %s', v_name),
                        case when new.message_type = 'text' then left(new.content, 120) else 'Sent a photo' end, b.id);
  return null;
end $$;
create trigger chat_notify after insert on public.chat_messages
  for each row execute function public.chat_notify();

---------------------------------------------------------------------------
-- The conversation list (one row per paid booking), newest first
---------------------------------------------------------------------------
create function public.my_conversations()
returns table (booking_id uuid, booking_ref text, status public.booking_status, shoot_date date, shoot_time time,
               other_id uuid, other_name text, other_photo text,
               last_message text, last_at timestamptz, last_from_me boolean, unread int)
language sql stable security definer set search_path = public, pg_temp as $$
  with mine as (
    select b.*, pp.user_id as photographer_user,
           case when b.client_id = auth.uid() then pp.user_id else b.client_id end as other_user
      from public.bookings b
      join public.photographer_profiles pp on pp.id = b.photographer_id
     where auth.uid() is not null
       and (b.client_id = auth.uid() or pp.user_id = auth.uid())
       and b.payment_status <> 'pending' and b.status <> 'pending'
  )
  select m.id, m.booking_ref, m.status, m.shoot_date, m.shoot_time,
         m.other_user, o.full_name, o.profile_photo_url,
         lm.content, coalesce(lm.created_at, m.created_at), coalesce(lm.sender_id = auth.uid(), false),
         (select count(*)::int from public.chat_messages c
           where c.booking_id = m.id and c.message_type <> 'system' and c.sender_id is distinct from auth.uid()
             and c.created_at > coalesce((select r.last_read_at from public.chat_reads r where r.booking_id = m.id and r.user_id = auth.uid()), '-infinity'))
    from mine m
    left join public.profiles o on o.id = m.other_user
    left join lateral (select c.content, c.created_at, c.sender_id, c.message_type from public.chat_messages c
                        where c.booking_id = m.id order by c.created_at desc limit 1) lm on true
   order by coalesce(lm.created_at, m.created_at) desc;
$$;

create function public.chat_unread() returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(unread), 0)::int from public.my_conversations();
$$;

revoke all on function public.mark_chat_read(uuid), public.my_conversations(), public.chat_unread() from public, anon;
grant execute on function public.mark_chat_read(uuid), public.my_conversations(), public.chat_unread() to authenticated;
