# Security — Gym Management + CRM SaaS

## 1. Security principles

- **Server-side authority.** The client is untrusted for identity, tenancy, roles, payments, and attendance.
- **Fail closed.** Missing/ambiguous authorization → deny.
- **Least privilege.** Staff roles grant the minimum permissions needed.
- **Defense in depth.** Authentication + authorization + validation + audit + secrets handling.
- **No secrets in code or client bundles.** Configuration via environment variables only.

## 2. Authentication (future, not implemented yet)

- Session-based authentication; server holds the session, client holds an HttpOnly cookie.
- Passwords hashed with a strong KDF (e.g. argon2id or bcrypt with adequate cost).
- Rate-limit login and account-recovery endpoints.
- Multi-factor authentication: optional, recommended for Owner roles.
- Session revocation on password change and account deactivation.

## 3. Multi-tenancy security

- The tenant key is always derived server-side from the session.
- Every org-owned query includes `organization_id = <tenant>`.
- Client-supplied tenant/org IDs are ignored.
- Out-of-tenant access attempts are denied with an indistinguishable 403/404.

## 4. Application-layer security

### Input validation
- All request input validated against a schema before use (e.g. `zod`).
- Max lengths, type checks, enum whitelists, and format checks on all fields.

### Output safety
- XSS: React escapes by default; never use `dangerouslySetInnerHTML` with user data without sanitization.
- CSP headers set for the app. Inline scripts avoided.
- No user-controlled HTML executed server-side.

### Injection
- All SQL via Prisma parameterized queries; no string-built SQL.
- IDs are typed UUIDs and validated; no ORM injection surfaces.

### CSRF
- State-changing Server Actions are protected; verify origin/referer and use SameSite=strict cookies. Idempotency/CSRF tokens for cross-origin state changes.

## 5. QR attendance security

Prioritized flow and requirements live in `QR_ATTENDANCE.md`. Security-relevant guarantees here:

- Member identity comes from a **server-issued, short-lived QR session/token**, not from a static QR containing a member ID.
- Only a **token hash** may be stored; never the raw token.
- Tokens expire and can be revoked.
- Check-in binds to the token issuer, member, location, and timestamp; duplicate scans rejected.

## 6. Payments security

- Client never sends authoritative amount/status; it submits recorded payment intent that the server validates.
- Payment mutations are audited and transactional.
- Refund/void only permitted for users with `payment:refund` / `payment:void`.
- Money stored as integer minor units.

## 7. Audit logging

- Log: authentication events, permission denials, role/permission changes, payments (create/refund/void), membership lifecycle changes, lead conversion/reassignment, QR token issuance, automation failures.
- Audit entries are append-only and tenant-scoped; include actor, action, entity, before/after (JSONB), and timestamp.
See `DATABASE_DESIGN.md` §4.22.

## 8. Secret and credential management

- Environment variables only; `.env*` is git-ignored (already present in `.gitignore`).
- Production secrets injected by the deployment platform; never committed.
- Future integrations (WhatsApp, Instagram/Facebook, payment gateway) store credentials **encrypted at rest** and reference them by id — never embed in client code. See `INTEGRATIONS.md`.

## 9. Webhooks and integrations security (future)

- Outbound/incoming webhooks verified by HMAC signature and/or signed payloads.
- Webhook endpoints have a fixed secret per integration and reject unsigned requests.
- Credential rotation and revocation supported.
See `INTEGRATIONS.md`.

## 10. Operational security

- Rate limiting on auth and sensitive endpoints.
- Backups with point-in-time recovery for the shared Postgres.
- Dependency hygiene: keep Next.js, Prisma, and runtime deps updated; `npm audit` reviewed.
- Error responses must not leak stack traces or schema details.
- Request logging without sensitive PII by default.

## 11. Data protection

- Personal data (member/lead contact info) is tenant-scoped and access-controlled.
- Support export/delete per data-protection requirements (a later feature);
- All times in UTC; PII minimization at the API boundary.

## 12. Testing security requirements

See `TESTING_STRATEGY.md` for concrete test cases covering the guarantees above (tenant isolation, authorization, QR replay, payment tampering, webhook signature).
