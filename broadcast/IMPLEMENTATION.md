# WhatsApp Broadcast implementation and verification — 2026-10-08

## Release state
Broadcast is integrated in the main menu of the actual CRM at https://futuresecureproviders.com/crm/ (website repository Futuresecure/futuresecure.github.io, crm/index.html, service worker v51). Backend code and verification are recorded in this repository.

**Live dispatch remains OFF: send_enabled=false, mode=test.** WHATSAPP_APP_SECRET / META_APP_SECRET is absent. Production approval and dispatch both fail closed without it. The user requested completion without intermediate approval; no approval question was introduced. A missing server secret cannot be safely invented. Configure the Meta app's App Secret privately in Supabase; signed real webhook verification and remaining device validation must pass before live activation. Do not paste access tokens or App Secret into chat.

## Implemented
- CRM menu, campaign drafts, approved MARKETING template preview and friendly variable inputs.
- Manual queueing, future scheduling with explicit India time, cancellation and campaign selection.
- Dated explicit consent evidence; atomic opt-out revokes consent and skips pending recipients. STOP, UNSUBSCRIBE, CANCEL, END and QUIT incoming messages opt out.
- Auto-refresh reports, sent/delivered/read timestamps and failures, inbox integration.
- Idempotent campaign creation; campaign+phone uniqueness; unique Meta IDs; conditional worker claims.
- Dedicated broadcast-worker with a strong Vault-held scheduler token, SHA-256 constant-time verification, independent one-minute cron fsp-broadcast-dispatch. Existing lead/appointment automation does not dispatch broadcasts.
- Consent, opt-out, campaign state and live gate rechecked for each send. Test and live campaign scopes separated.
- Timeout/unknown provider outcomes are not retried automatically. Bounded retries for definite transient provider failures.
- Atomic buffered delivery events preserve read/delivered state and reconcile callbacks arriving before the recipient's Meta ID is saved.
- Administrator allowlist, owner checks, JWT on management API, RLS and service-only consent/delivery RPCs. Webhook HMAC validation when App Secret is configured; legacy webhook operation preserved while missing secret keeps broadcast disabled.
- Approved MARKETING templates with text bodies; unsupported media/dynamic header/URL parameters rejected at approval.

## Verification evidence
| Check | Result |
| --- | --- |
| Automated handler/dispatch/security/regression checks | 41 passed: node tests/broadcast.test.cjs |
| Actual Meta test sender | +1 555-183-0040, verified Test Number; only owner's verified recipient |
| Manual shared-code send | Actual webhook reported sent, delivered, read |
| Scheduled shared-code send | Sent after due time; actual webhook reported sent, delivered, read |
| Duplicate, cancellation, opt-out | Repeat worker sent zero duplicates; cancelled campaign sent zero; consent revoked and pending skipped |
| Authenticated actual CRM | Menu/templates/reports loaded; double draft-create produced one empty campaign; cancelled afterward |
| Responsive browser component | 390px mobile and 1100px desktop; no body overflow; create/select/schedule/opt-out controls exercised |
| Schedule validation | Empty schedule rejected; India-time schedule/report matched |
| Existing CRM regression | Inbox, 30 leads and connected calendar rendered; existing frontend functions and lead/appointment dispatch block preserved |
| Delivery race | Actual database transaction: callback before Meta-ID save reconciled to read; later sent/failed did not regress read; rolled back |
| Failed-event guard | Actual database transaction: sent reconciliation did not overwrite failure; read remained terminal; rolled back |
| Worker security | Missing token 401; Vault-authorized request 200, disabled, sent=0 |
| Scheduler | Active independent cron; latest run succeeded; live gate remained OFF |
| Database protections | Zero duplicate recipients/Meta IDs; new delivery RPC execute denied anon/authenticated and granted service_role |

Mobile testing was responsive browser testing of the exact Broadcast component. Physical Android/iOS/PWA end-to-end verification has not been completed. Full live signed Meta webhook verification cannot pass until the App Secret is configured. Therefore this is an implemented, safely deployed feature with blocked live activation, not an all-gates-complete live release.

Existing project security-advisor warnings remain outside this broadcast change: intentionally exposed website lead/appointment RPCs, existing unread-counter EXECUTE grants, password-protection setting and informational RLS-without-policy findings. No unrelated security configuration was changed.

## Cleanup and operations
Temporary test cron removed; isolated runner disabled with JWT verification ON. Temporary owner test consent revoked and temporary opt-out cleared. Empty UI QA campaign cancelled. No production customer received a test message.

The worker token is encrypted in Vault as fsp_broadcast_worker_token; the cron obtains it internally. No plaintext token is stored in repository code or cron command. Worker source contains only its digest. To rotate, replace the Vault token privately and deploy the corresponding digest together. Never reuse the legacy webhook verification token as worker authentication.

Published UI commit: b22b03a2765f261de78a555c8f61db5a0abe0311; actual CRM cache release v51: fd646f195d329aa046a819481a2906bd4801f9be.
Deployed broadcast-manage v6, broadcast-worker v2, whatsapp-webhook v24.
