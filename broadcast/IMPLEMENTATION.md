# WhatsApp Broadcast implementation and verification — 2026-10-08

## Release state
Broadcast is integrated in the main menu of the actual CRM at https://futuresecureproviders.com/crm/ (website repository Futuresecure/futuresecure.github.io, crm/index.html, service worker v51). Backend code and verification are recorded in this repository.

**Live dispatch remains OFF: send_enabled=false, mode=test.** WHATSAPP_APP_SECRET is configured and verified against the actual Future Secure Meta app (809254711889670). Production approval and dispatch both fail closed without it. The user requested completion without intermediate approval; no approval question was introduced. Signed real Meta webhook verification now passes. Physical mobile/PWA verification remains pending before live activation; the cloud browser cannot access the owner's installed phone PWA. Do not paste access tokens or App Secret into chat.

## Implemented
- CRM menu, campaign drafts, approved template preview and friendly variable inputs.
- Manual queueing, future scheduling with explicit India time, cancellation and campaign selection.
- Dated explicit consent evidence; atomic opt-out revokes consent and skips pending recipients. STOP, UNSUBSCRIBE, CANCEL, END and QUIT incoming messages opt out.
- Auto-refresh reports, sent/delivered/read timestamps and failures, inbox integration.
- Idempotent campaign creation; campaign+phone uniqueness; unique Meta IDs; conditional worker claims.
- Dedicated broadcast-worker with a strong Vault-held scheduler token, SHA-256 constant-time verification, independent one-minute cron fsp-broadcast-dispatch. Existing lead/appointment automation does not dispatch broadcasts.
- Consent, opt-out, campaign state and live gate rechecked for each send. Test and live campaign scopes separated.
- Timeout/unknown provider outcomes are not retried automatically. Bounded retries for definite transient provider failures.
- Atomic buffered delivery events preserve read/delivered state and reconcile callbacks arriving before the recipient's Meta ID is saved.
- Administrator allowlist, owner checks, JWT on management API, RLS and service-only consent/delivery RPCs. Webhook HMAC validation when App Secret is configured; legacy webhook operation preserved while missing secret keeps broadcast disabled.
- Approved templates of all categories with supported text bodies; unsupported media/dynamic header/URL parameters rejected at approval.

## Verification evidence
| Check | Result |
| --- | --- |
| Automated handler/dispatch/security/regression checks | 66 passed: node tests/broadcast.test.cjs |
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

Mobile testing was responsive browser testing of the exact Broadcast component. Physical Android/iOS/PWA end-to-end verification has not been completed. Actual signed Meta webhook verification passed after App Secret Proof was added to Graph requests. A new own-number test reached read. Physical phone/PWA verification remains uncompleted. Therefore this is an implemented, safely deployed feature with blocked live activation, not an all-gates-complete live release.

Existing project security-advisor warnings remain outside this broadcast change: intentionally exposed website lead/appointment RPCs, existing unread-counter EXECUTE grants, password-protection setting and informational RLS-without-policy findings. No unrelated security configuration was changed.

## Cleanup and operations
Temporary test cron removed; isolated runner disabled with JWT verification ON. Temporary owner test consent revoked and temporary opt-out cleared. Empty UI QA campaign cancelled. No production customer received a test message.

The worker token is encrypted in Vault as fsp_broadcast_worker_token; the cron obtains it internally. No plaintext token is stored in repository code or cron command. Worker source contains only its digest. To rotate, replace the Vault token privately and deploy the corresponding digest together. Never reuse the legacy webhook verification token as worker authentication.

Published UI commit: b22b03a2765f261de78a555c8f61db5a0abe0311; actual CRM cache release v51: fd646f195d329aa046a819481a2906bd4801f9be.
Deployed broadcast-manage v8, broadcast-worker v4, whatsapp-webhook v26, whatsapp-send v11, whatsapp-templates v9, whatsapp-automation-worker v12.

## App Secret completion update
- Meta app and production/test token ownership verified; configured App Secret matches the Future Secure app. No secret values were read into chat or stored in source.
- Valid signed empty webhook: 200; forged and unsigned callbacks: 403.
- Initial own-number test was definitively rejected with 131005 Access denied. Adding HMAC App Secret Proof resolved it. This exact test campaign subsequently reached sent/delivered/read through real signed Meta callbacks.
- App Secret Proof added to all six WhatsApp Graph callers. Existing business logic compared against original source and preserved exactly apart from the authentication helper/call routing. Supabase/non-Meta requests remain unchanged.
- Signed test campaign: 68847f80-4bd3-42a7-a47f-7e9cbf75fb2d; sent 2026-10-08T11:45:45.634Z, delivered 11:45:47Z, read 11:46:01Z.
- New actual authenticated Broadcast mobile-width check: 390px frame, content width 375px, document/body scroll width 375px; desktop content 1085px with no horizontal overflow. Hamburger/menu closure, template preview, safe zero-recipient draft creation, repeat-create idempotency, cancellation and signed report timestamps exercised against the actual backend.
- Mobile QA draft 50530cd6-4344-4138-adee-b9c4bfd0a2a2 is cancelled and has zero recipients.
- Desktop regression rechecked after deployment: 8 Inbox contacts, approved enquiry/appointment/marketing templates, connected calendar and 4 appointment rows. No production customer sends were used.
- Real mobile/desktop verification wrapper: crm/tests/responsive.html in the website repository; it contains no credentials or customer data.
- Temporary isolated runner disabled with JWT ON (v16); owner test consent restored to revoked. Zero scheduled live campaigns, zero duplicate recipients and all Broadcast tables RLS-enabled.
- Live flag remains OFF pending physical phone/PWA verification. There is no remaining App Secret configuration blocker.

## All-template selection update
Broadcast now displays every returned template with language, category and approval status. Non-approved templates are displayed disabled. Approved UTILITY templates can be queued and dispatched; the category-only restriction was removed in both approval and worker revalidation. Unsupported media/dynamic header, dynamic URL and OTP/copy-code button parameters remain rejected before queueing. Consent, opt-out, ownership, signature, duplicate prevention and live OFF gates are retained. 66 automated checks passed, including approved utility dispatch and pending-template rejection. No actual production messages were sent during this change. Actual CRM service-worker cache v52.


## CSV / Excel bulk import — 2026-10-08

Broadcast now supports CSV and Excel .xlsx (first worksheet), up to 500 contacts / 2 MB per file. Required columns: Name, Mobile, Opt-in, Consent date, Evidence reference. India local dates are converted explicitly to +05:30. The downloadable sample defaults to No and blank evidence. Preview is read-only; committing requires verified-consent confirmation. Only explicit Yes rows with valid evidence are imported. Existing opt-outs and revoked consent are never re-enabled by bulk import. Imported names persist and valid imported/existing contacts are selected for attaching to a draft. Import never schedules or sends messages. Campaign attachment uses batches of 500. Result CSV export neutralizes spreadsheet formula prefixes.

Management API validates independently, permits only the existing allowlisted admin and invokes a service-only, security-invoker atomic import RPC. Phone locks and conflict handling prevent duplicate inserts; STOP checks apply again at dispatch. Existing CRM leads and automation are untouched. Excel reader is lazy-loaded, version-pinned ExcelJS 4.4.0 with SHA-384 integrity. Formulas and hyperlinks are rejected; expanded archive limit 20 MB and 2,000 entries.

Validation: 75 management/worker/regression checks passed; CSV quoting/BOM/headers/IST, real XLSX numeric phone, formula rejection and archive/file limits passed. Production SQL tests ran inside BEGIN/ROLLBACK: preview made no writes, commit/import retry deduplicated, STOP prevented re-import, QA records persisted = 0. RPC execution denied to anon/authenticated; service-only. No customer test messages sent. Live sending remains OFF pending the previously outstanding physical mobile PWA check.

Published Pages deployment completed successfully (CRM PWA v53). The authenticated live CRM visibly rendered the import card, file input, preview, consent confirmation and disabled import button. Direct file-chooser UI verification was blocked by retained native credential session restrictions; restarting the browser runtime remained blocked. It is not recorded as a successful physical/mobile file upload test. Existing CRM/Inbox/Leads/Calendar markup and JS are byte-preserved outside the Broadcast section, except PWA cache version. Reproduce parser tests with `npm ci --prefix tests`, then `node tests/broadcast-import.test.cjs`; management regression with `node tests/broadcast.test.cjs` (Node supporting stripTypeScriptTypes).
