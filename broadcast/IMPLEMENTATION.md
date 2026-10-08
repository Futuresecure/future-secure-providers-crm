# WhatsApp Broadcast — isolated implementation plan

Status: DEVELOPMENT ONLY. No live send enabled.

## Isolation
- Keep main branch, current webhook, whatsapp-send, templates, automation worker and existing database tables unchanged.
- Broadcast uses dedicated campaign, recipient, consent and send-log tables. Enable RLS and deny client writes by default.
- No new sender is deployed until Meta template, explicit marketing opt-in and authenticated server-side authorization are verified.

## Workflow
1. Select opted-in CRM contacts; normalize Indian phone numbers and deduplicate per campaign.
2. Choose an approved marketing template and preview personalization.
3. Draft campaign and optionally schedule it.
4. Explicit approval to queue; worker uses rate limits, idempotency keys, retry backoff, opt-out and quiet-hour rules.
5. Track queued, submitted, delivered, read, failed; reconcile existing webhook statuses without modifying the webhook until tested.

## Release gates
- Test in isolation with own opted-in number.
- Check existing lead capture, inbox, automation, appointment/calendar and Google Sheets workflows.
- Verify RLS, secret isolation, template eligibility, error handling and rollback.
- Feature flag OFF by default. No live sending before explicit approval.
