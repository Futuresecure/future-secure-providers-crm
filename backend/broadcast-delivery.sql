create table if not exists public.broadcast_delivery_events (
 meta_message_id text primary key,
 status text not null check(status in ('sent','delivered','read','failed')),
 event_at timestamptz not null,
 error_text text,
 updated_at timestamptz not null default now()
);
alter table public.broadcast_delivery_events enable row level security;
revoke all on public.broadcast_delivery_events from anon,authenticated;
grant all on public.broadcast_delivery_events to service_role;
create or replace function public.broadcast_apply_delivery(p_meta_id text,p_status text,p_at timestamptz,p_error text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare e public.broadcast_delivery_events;
begin
 if p_status not in ('sent','delivered','read','failed') or p_meta_id is null or length(p_meta_id)>500 then return; end if;
 insert into public.broadcast_delivery_events(meta_message_id,status,event_at,error_text)
 values(p_meta_id,p_status,p_at,left(p_error,500))
 on conflict(meta_message_id) do update set status=excluded.status,event_at=excluded.event_at,error_text=excluded.error_text,updated_at=now()
 where (case excluded.status when 'read' then 3 when 'delivered' then 2 when 'sent' then 1 when 'failed' then 1 else 0 end) > (case broadcast_delivery_events.status when 'read' then 3 when 'delivered' then 2 when 'sent' then 1 when 'failed' then 1 else 0 end)
 or (excluded.status=broadcast_delivery_events.status and excluded.event_at>broadcast_delivery_events.event_at)
 or (excluded.status='failed' and broadcast_delivery_events.status='sent');
 select * into e from public.broadcast_delivery_events where meta_message_id=p_meta_id for update;
 update public.broadcast_recipients set
  status=e.status,
  delivered_at=case when e.status='delivered' then e.event_at else delivered_at end,
  read_at=case when e.status='read' then e.event_at else read_at end,
  error_text=case when e.status='failed' then e.error_text else null end
 where meta_message_id=p_meta_id
 and (status not in ('delivered','read') or e.status in ('delivered','read'))
 and (status<>'read' or e.status='read');
 update public.whatsapp_messages set delivery_status=e.status,status_timestamp=e.event_at,
 read_at=case when e.status='read' then e.event_at else read_at end
 where meta_message_id=p_meta_id
 and (coalesce(delivery_status,'') not in ('delivered','read') or e.status in ('delivered','read'))
 and (coalesce(delivery_status,'')<>'read' or e.status='read');
end; $$;
revoke all on function public.broadcast_apply_delivery(text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.broadcast_apply_delivery(text,text,timestamptz,text) to service_role;
