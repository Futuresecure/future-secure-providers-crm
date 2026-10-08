alter table public.broadcast_optins add column if not exists display_name text not null default '';
create or replace function public.broadcast_import_optins(p_rows jsonb,p_user uuid,p_commit boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb; results jsonb:='[]'::jsonb; s text; phone text; at_time timestamptz;
begin
 if p_user is distinct from '4bd1c093-0912-4e63-a062-21d8fd759357'::uuid or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then raise exception 'Invalid import'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  phone:=r->>'phone'; s:=r->>'status';
  if s='ready' then
   if phone !~ '^91[6-9][0-9]{9}$' or length(r->>'reference') not between 3 and 500 or length(r->>'name')>120 then raise exception 'Invalid consent row'; end if;
   at_time:=(r->>'consent_at')::timestamptz;
   if at_time is null or at_time>now() then raise exception 'Invalid consent date'; end if;
   perform pg_advisory_xact_lock(hashtextextended(phone,0));
   if exists(select 1 from public.broadcast_optouts where wa_id=phone) then s:='opted_out';
   elsif exists(select 1 from public.broadcast_optins where wa_id=phone and revoked_at is not null) then s:='revoked';
   elsif exists(select 1 from public.broadcast_optins where wa_id=phone) then s:='existing';
   elsif p_commit then
    insert into public.broadcast_optins(wa_id,display_name,consent_at,consent_source,consent_reference,recorded_by) values(phone,r->>'name',at_time,'imported_record',r->>'reference',p_user) on conflict(wa_id) do nothing;
    if found then s:='imported'; else s:='existing'; end if;
   end if;
  end if;
  results:=results||jsonb_build_array(r||jsonb_build_object('status',s));
 end loop;
 return results;
end; $$;
revoke all on function public.broadcast_import_optins(jsonb,uuid,boolean) from public,anon,authenticated;
grant execute on function public.broadcast_import_optins(jsonb,uuid,boolean) to service_role;
