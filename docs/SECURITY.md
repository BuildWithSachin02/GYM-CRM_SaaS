# Security — Gym Management + CRM SaaS

## 1. Security principles

- **Server-side authority.** The client is untrusted for identity, tenancy, roles, payments, and attendance.
- **Fail closed.** Missing/ambiguous authorization → deny (redirect for pages, error result for actions).
- **Least privilege.** Staff roles grant the minimum baseline permissions; finer control via per-user overrides.
- **Defense in depth.** Authentication + authorization + validation + audit + secrets handling.
- **No secrets in code or client bundles.** Configuration via environment variables only.

## 2. Authentication (implemented)

- **Email + password login.** Passwords hashed with **bcrypt** (`src/lib/auth/password.ts`); plaintext is never stored or logged.
- **Session cookie** `gym_session`: a stateless **HMAC-SHA256-signed** token (`AUTH_SECRET`) containing `{ userId, exp, v }`, `HttpOnly`, `SameSite=Lax`, 7-day expiry, secure in production, works in both Node and Edge (middleware/proxy) via WebCrypto (`src/lib/auth/session.ts`).
- Every request re-authenticates: `getCurrentUser` verifies the signature/expiry, then loads the user, re-checks status ACTIVE, compares the cookie's session version `v` to `User.sessionVersion`, and recomputes effective permissions from the DB.
- Login rate limiting / MFA are planned, not yet implemented.

## 3. Session revocation (sessionVersion)

`User.sessionVersion` is the revocation clock. `createSessionToken(userId, sessionVersion)` embeds `v = sessionVersion` in the cookie. Signing in with a **stale version is treated as unauthenticated** (`getCurrentUser` rejects `decoded.v !== user.sessionVersion`), so old cookies stop working without a session table.

`sessionVersion` is bumped (revoking all existing sessions) after:

- Deactivation and reactivation (`setUserStatus`)
- Role change, username change, or status change (`updateStaff` — any security-relevant field)
- Password change / reset (`changeOwnPassword`, `resetPassword`)
- Permission update (`updateUserPermissions`)

When the **current user** performs a security-sensitive change on their own account, the server re-issues their own cookie at the new version (`refreshOwnSessionIfNeeded`) so they stay signed in; every other session dies instantly. If their own access was changed, the re-issued cookie also reflects the new permissions immediately.

## 4. Users & Access security rules (implemented)

Enforced server-side in `src/lib/actions/users.ts` (`findStaffInOrg` + guards):

- **No self-deactivation** — a user cannot deactivate their own account.
- **Last-owner protection** — the last active OWNER can never be deactivated or demoted; an organization always keeps at least one active owner.
- **OWNER-only creation/promotion** — only an OWNER may create or promote a user to OWNER; an ADMIN (even with `staff:manage`) cannot.
- **OWNER immunity** — owner accounts always have full access; permission overrides and the permission editor cannot narrow them.
- **Organization isolation** — all staff/override/audit queries and mutations are scoped to `user.organizationId`; cross-tenant IDs resolve to not-found.
- **Soft deactivation** — accounts are deactivated, never hard-deleted, preserving audit history and ownership records.
- **Password handling** — only bcrypt hashes are stored (or reset via the hashed path); passwords never appear in responses, audit payloads, or logs; a reset invalidates the target's previous sessions.

## 5. Username vs login email

- **Login identifier is always email** (lowercased, unique per organization).
- **Username** is an optional, **organization-scoped display alias** (`@handle` shown in the UI), normalized (trim + lowercase) and validated (`3–32` chars, `[a-z0-9._-]`, no leading/trailing separator) on create and edit. It is never used for authentication.

## 6. Multi-tenancy security

- The tenant key is always derived server-side from the session (`user.organizationId`).
- Every org-owned query includes the tenant filter; client-supplied org/role/permission values are ignored or re-validated server-side.
- Out-of-tenant access attempts return indistinguishable "not found"/"not authorized" errors (no enumeration).
- The `UserPermission` table is unique per `(organizationId, userId)` and every row is created with the actor's tenant key.

## 7. Application-layer security

### Input validation
- All request input validated with zod before use (max lengths, type checks, enum whitelists, UUIDs, date formats).

### Output safety
- React escapes by default; no `dangerouslySetInnerHTML` with user data.
- No user-controlled HTML executed server-side.

### Injection
- All SQL via Prisma parameterized queries; IDs are validated UUIDs.

### CSRF
- State changes go through typed Server Actions (same-site cookie, validation server-side).

## 8. QR attendance security

See `QR_ATTENDANCE.md`. Guarantees implemented:

- Member identity from a **server-issued, short-lived QR session/token**, not a static member-ID QR; only the token hash is ever stored.
- Tokens expire and can be revoked; duplicate scans rejected.
- **Trusted devices** (`MemberDevice`): raw token only in an HttpOnly cookie, only SHA-256 hash stored, opt-in, cap-limited, revocable; every scan re-validates tenancy, QR validity, membership coverage and duplicate rules server-side.
- Device remember requires an explicit identity-confirmation screen; "Not you?" revokes the device and records the safety event without writing attendance.
- **Staff correction** reassigns the existing CheckIn (never deletes/duplicates), is gated to OWNER/ADMIN + `attendance:record`, re-validates tenancy, and writes before/after audit entries.
- **Expired-membership scans** create a PENDING `AttendanceRequest` for staff review instead of a silent denial.

## 9. Payments security

- Client submits recorded payment intent; server validates and owns authoritative amounts; money stored as integer minor units.
- `payments:record` gates record/void; mutations are transactional and audited.

## 10. Audit logging

- Tenancy-scoped, append-only `AuditLog` rows with actor, action, entity, before/after JSONB, timestamp.
- Users & Access audit actions: `STAFF_CREATED`, `STAFF_UPDATED`, `USER_DEACTIVATED`, `USER_REACTIVATED`, `USER_ROLE_CHANGED`, `PASSWORD_CHANGED`, `PASSWORD_RESET`, `PERMISSIONS_UPDATED` (with granted/revoked diff). Also login/logout, payments, memberships, leads, QR, trainers, appointments, tasks, settings, data-reset events.
- The Users & Access **Activity** dialog shows the last 50 events for a user (as entity or actor).

## 11. Secret and credential management

- Environment variables only; `.env*` is git-ignored (present in `.gitignore`).
- Secrets (`AUTH_SECRET`, `DATABASE_URL`) are injected by deployment; never committed.
- Future integrations store credentials encrypted at rest (see `INTEGRATIONS.md`).

## 12. Operational security

- Rate limiting on auth endpoints: planned, not yet implemented.
- Error responses do not leak stack traces or schema details.
- Backups and point-in-time recovery for the shared Postgres.

## 13. Testing security requirements

- Pure decision-layer tests: `tests/users-access.test.ts` (effectivePermissions, grants/revokes, OWNER immunity, owner-role rules, last-owner guard, self-deactivation, username, permission-matrix integrity, diffPermissions) and `tests/validators.test.ts` (staff/password/permission schemas, strict no-password update).
- DB-backed guarantees (session bump/rejection, cookie re-issue, org-SQL isolation, audit rows) are exercised manually via the QA checklist in the final task report.