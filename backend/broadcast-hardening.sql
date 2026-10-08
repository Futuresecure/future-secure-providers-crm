alter table public.broadcast_campaigns add column if not exists request_id uuid;
alter table public.broadcast_campaigns add column if not exists send_mode text not null default 'live' check (send_mode in ('live','test'));
alter table public.broadcast_recipients add column if not exists delivered_at timestamptz;
alter table public.broadcast_recipients add column if not exists read_at timestamptz;
create unique index if not exists broadcast_campaign_request_once on public.broadcast_campaigns(created_by,request_id) where request_id is not null;
create unique index if not exists broadcast_meta_message_once on public.broadcast_recipients(meta_message_id) where meta_message_id is not null;
create or replace function public.broadcast_record_optout(p_phone text,p_reason text) returns void language plpgsql security invoker set search_path='' as $$
begin
 insert into public.broadcast_optouts(wa_id,reason) values(p_phone,left(p_reason,500)) on conflict(wa_id) do update set reason=excluded.reason;
 update public.broadcast_optins set revoked_at=now() where wa_id=p_phone and revoked_at is null;
 update public.broadcast_recipients set status='skipped',error_text='Customer opted out' where wa_id=p_phone and status='pending';
end; $$;
revoke all on function public.broadcast_record_optout(text,text) from public,anon,authenticated;
grant execute on function public.broadcast_record_optout(text,text) to service_role;
create or replace function public.broadcast_record_optin(p_phone text,p_at timestamptz,p_source text,p_reference text,p_user uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 insert into public.broadcast_optins(wa_id,consent_at,consent_source,consent_reference,recorded_by,revoked_at) values(p_phone,p_at,p_source,p_reference,p_user,null) on conflict(wa_id) do update set consent_at=excluded.consent_at,consent_source=excluded.consent_source,consent_reference=excluded.consent_reference,recorded_by=excluded.recorded_by,revoked_at=null;
 delete from public.broadcast_optouts where wa_id=p_phone;
end; $$;
revoke all on function public.broadcast_record_optin(text,timestamptz,text,text,uuid) from public,anon,authenticated;
grant execute on function public.broadcast_record_optin(text,timestamptz,text,text,uuid) to service_role;
