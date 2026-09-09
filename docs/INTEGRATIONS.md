# Integrations — Gym Management + CRM SaaS

## 1. Integration philosophy

- **Verified and secure by default.** Every external interaction (webhook in or out) is signature/secret-verified.
- **Credentials never in client code**; stored encrypted at rest and referenced by id.
- **Channel adapters behind interfaces** so capabilities can be added without touching domain logic.
- The first integrations are **future** work; the foundation (lead sources, notifications, webhook abstractions) is designed now.

## 2. Cross-cutting security requirements

- Credentials stored encrypted in the database; only the integration service can decrypt with a server-side key.
- Rotation and revocation supported; revoked credentials stop working immediately.
- Inbound webhooks: verify HMAC signature / signed payload with a per-integration secret; reject unsigned or mismatched requests with 401.
- Outbound webhooks: sign payloads; support retry with idempotency keys.
- Rate limiting on inbound webhook endpoints.
- Every webhook event is logged and tenant-scoped (never crosses tenant boundaries).
- Reference `SECURITY.md` §9 and `AUTHENTICATION`/`AUTHORIZATION` rules: integrations act with the organization's service identity, never broader.

## 3. WhatsApp integration (future)

### Purpose
- Notify leads/members and staff (e.g. follow-up reminders, payment reminders, promotion messages).
- Capture inbound WhatsApp inquiries as leads with `source = whatsapp`.

### Design
- Provider adapter (e.g. WhatsApp Business Platform / Cloud API) behind a `MessageChannel` interface.
- Outbound: send + delivery status; retryable; idempotent by message key.
- Inbound: verified webhook → maps to `LeadActivity` / new `Lead` with source `whatsapp`.
- Opt-in/consent tracking per phone number; do-not-contact respects member/lead preferences.
- Templates pre-approved and versioned where required by the provider.

## 4. Instagram / Facebook integration (future)

### Purpose
- Source attribution: content/ads landing in the CRM with `source = instagram` / `facebook`.
- Inbound conversations (DM/messenger) become leads/activities via verified webhooks.
- Optionally publish/respond through the adapter, with manual approval.

### Design
- Meta Graph API adapter behind an `InboundLeadSource` interface.
- Verified webhook signature (App Secret + hub verify token).
- Ad/post attribution maps to `source_detail` (campaign/ad/post id).
- Token storage: long-lived access token, encrypted, refreshable; token expiry should surface as an alert.

## 5. Payment gateway integration (future)

### Current state
- No payment gateway is part of initial implementation. **Manual payment recording is required first**.
- Any future gateway (e.g. Razorpay, Stripe, PayU) is additive and must preserve the manual-recording flow.

### Design (when added)
- A `PaymentProvider` adapter with: create payment intent, capture, refund, void, webhook handling.
- Gateway webhooks verified by signature; update payment status only from verified server events.
- Idempotency keys prevent duplicate captures/charges.
- Reconciliation: manual and gateway payments recorded together in the same `Payment` entity so reports/balances are unified.
- Stored credentials encrypted; test/live environment separation.

## 6. Email (future)

- A `MessageChannel` adapter for email notifications and campaign sending.
- Signed inbound (bounce/unsub) webhooks, rate-limited.

## 7. Webhook framework (inbound, general)

- Central webhook controller validates signature per registered integration.
- Dispatches authenticated, tenant-scoped events into the outbox → automation/dispatcher.
- Unknown/unsigned events are dropped and logged.

## 8. Outbound delivery & observability

- All outbound sends are represented as `Notification` records with channel and status (`queued`/`sent`/`failed`).
- Retry with backoff; dead-letter on persistent failure.
- Provider error and webhook delivery are observable in admin (`integration logs` / `audit`).

## 9. Enabling integrations per organization

- Integrations are optional and configured per organization (enabled flag + secrets).
- A tenant's data is never sent to a provider unless that tenant has the integration configured.
- "King's Gym" is only the first demo tenant; no integration config is hardcoded to it.

## 10. Testing integrations

See `TESTING_STRATEGY.md`: webhook signature tests, credential encryption/rotation, idempotency, and provider failure/retry tests, all using mocked provider adapters.
