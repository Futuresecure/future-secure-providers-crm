# WhatsApp Broadcast — release status

Status: implemented on the isolated feature branch; live sending remains disabled.

## Delivered
- CRM page for creating campaigns, registering evidenced marketing opt-ins, selecting eligible contacts, scheduling, cancellation and per-contact delivery reports.
- Authenticated `broadcast-manage` Edge Function (v3) with campaign-owner checks, approved marketing-template validation, duplicate prevention, consent/opt-out filtering and server-side reporting.
- Additive broadcast tables and indexes. Client roles cannot read consent records or write campaign/recipient records.
- Existing WhatsApp webhook (v19) records delivery/read/failure states for broadcast messages, handles STOP and common opt-out keywords, and processes due campaigns through the existing scheduled worker.
- A database feature gate (`broadcast_settings.send_enabled=false`, mode=`test`) prevents all broadcast sends by default.

## Existing setup
- The CRM source change is isolated in `feature/whatsapp-broadcast-isolated`; `main` was not changed.
- The existing inbox, sender, template service, automation queue and scheduler remain in place. Broadcast processing is additive and is called only by the existing internal worker.
- The database change only adds broadcast consent/settings fields, indexes and access restrictions; existing lead, appointment, calendar, inbox and automation records were not migrated.

## Release gate
Live sending is not enabled. The configured WhatsApp sender is the production sender, and no separate Meta test-number credentials are available in this session. Do not turn `broadcast_settings.send_enabled` on until a test number is configured and an end-to-end test confirms template acceptance, message delivery, webhook status updates, opt-out handling, and inbox/report consistency. After that gate passes, publish the feature branch CRM UI and enable live sending.
