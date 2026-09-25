-- ============================================================
--  日程 · 云同步  Supabase 建表脚本
--  在 Supabase 控制台 → SQL Editor 里整段执行一次即可（可重复执行）。
--  前端见 sync.js：每个账号一行，整份日程存成一个 jsonb 文档，
--  用 rev 做乐观锁——推送时带上"我是基于哪个 rev 改的"，对不上就拒绝，由前端合并后重推。
-- ============================================================

create table if not exists public.agendas (
  user_id    uuid        primary key references auth.users on delete cascade,
  doc        jsonb       not null,
  rev        bigint      not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.agendas enable row level security;

-- 只能读自己那一行；写入一律走下面的 push_agenda，不开放直接 insert / update / delete
drop policy if exists "read own agenda" on public.agendas;
create policy "read own agenda" on public.agendas
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.agendas from anon, authenticated;
revoke all on public.agendas from anon;
grant select on public.agendas to authenticated;

-- 乐观锁推送：p_base_rev 与云端当前 rev 相同才写入，返回新 rev；不同返回 -1。
-- p_base_rev = 0 表示"云端还没有这一行"，此时插入；若已有则同样返回 -1。
create or replace function public.push_agenda(p_doc jsonb, p_base_rev bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := auth.uid();
  new_rev bigint;
begin
  if me is null then
    raise exception '未登录' using errcode = '28000';
  end if;
  if jsonb_typeof(p_doc) <> 'object' then
    raise exception '数据格式不对' using errcode = '22023';
  end if;
  if octet_length(p_doc::text) > 5000000 then          -- 单个账号 5 MB 上限，防滥用
    raise exception '数据太大' using errcode = '54000';
  end if;

  if p_base_rev = 0 then
    insert into public.agendas (user_id, doc, rev)
    values (me, p_doc, 1)
    on conflict (user_id) do nothing
    returning rev into new_rev;
  else
    update public.agendas
       set doc = p_doc, rev = rev + 1, updated_at = now()
     where user_id = me and rev = p_base_rev
    returning rev into new_rev;
  end if;

  return coalesce(new_rev, -1);
end;
$$;

revoke all on function public.push_agenda(jsonb, bigint) from public, anon;
grant execute on function public.push_agenda(jsonb, bigint) to authenticated;

-- 注销账号：删掉 auth.users 里的自己，agendas 那一行随外键级联删除。
create or replace function public.delete_me()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception '未登录' using errcode = '28000';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;
