# QR Attendance — Gym Management + CRM SaaS

## 1. Security model

Attendance identity must **never** be encoded in a QR code, and a member ID must **never** be placed in a QR. Attendance uses:

1. An **authenticated member flow** to establish who is checking in, and
2. A **short-lived, location-bound gym QR session/token** as the reusable attendance point at the gym.

The QR/token carries **no member identity**. The member's identity is resolved server-side from the authenticated session; the QR session only proves "this check-in is happening at this location right now, against a valid short-lived token." This prevents a static QR from being a permanent key to any member's data.

## 2. Concepts

- **QRSession** — a server-issued, cryptographically random, short-lived token bound to a **location** (a gym attendance point), with an `expires_at` and optional `revoked_at`. It is **reusable**: multiple members may check in against the same token during its validity. Only the **hash** of the token is stored.
- **QR payload** — the opaque token string (or a URL containing it). Contains no member ID. Cannot be guessed (high-entropy random).
- **CheckIn** — the attendance record binding the **authenticated member**, the location, the QR session, and a timestamp.

## 3. Check-in flow (authenticated member flow)

```
1. Staff member displays a short-lived QRSession token for the location
   (server issues a Locationbound QR token; only the hash is stored).
2. Member authenticates in the member app / portal (server resolves identity).
3. Member scans/submits the current QR token for the location.
4. Server validates:
     - token exists, not revoked, not expired
     - token's location matches the check-in location
     - the authenticated member has an active membership at that location
5. Server records the CheckIn (idempotent within the duplicate window) binding
   the member identity + QR session, and returns success.
```

Member identity is resolved from the **authenticated session**, never from the QR content.

## 4. Alternative: staff-assisted check-in

Where members have no device, staff select or search the member in the attendance screen. The server still enforces membership validity and tenancy; the member identity comes from the server-resolved member record, not from a client-supplied raw ID. A location-based QRSession may still be used to scope the attendance point.

## 5. Server-side rules

- **Tenancy**: the QR session and check-in are organization-scoped; the staff user must have `attendance:record` at that location.
- **Membership validation**: a check-in requires an `active` membership status for the member at that location (with configured grace period). See `PRODUCT_REQUIREMENTS.md` FR-QR-05 / FR-MS-04.
- **Duplicate window**: a configurable window (default e.g. 5 minutes) rejects repeated check-ins of the same member at the same location.
- **Token handling**:
  - Store only `token_hash` (non-reversible), which is **unique**.
  - `token_hash` never maps back to a token or a member.
  - Revocation: a QRSession can be revoked by an authorized user (e.g. on staff request or if a token is suspected compromised).
  - Expiry: expired sessions are rejected and cleaned up; index on `expires_at` supports the cleanup job.

## 6. Edge cases

- **Token expired mid-scan**: reject with a clear message; staff refreshes to a new short-lived token.
- **Token reuse**: the duplicate-window logic prevents duplicate attendance per member; the token itself is reusable across different members by design.
- **Offline scanner**: no local trust; the check-in must be confirmed by the server. Offline caching is explicitly out of scope (would weaken identity guarantees).
- **Wrong location**: token is bound to a location; using it at another location's reader is rejected.
- **Member without active membership**: rejected; surfaced to staff for upsell (link to leads/CRM).
- **Compromised/revoked token**: revoked tokens are rejected at check-in regardless of validity window.

## 7. Data model

See `DATABASE_DESIGN.md` §4.11:

- **QRSession (location-bound, reusable)**: `token_hash` (unique), `organization_id`, `location_id` (the attendance point), `expires_at`, `revoked_at` (nullable), `created_by_user_id`, `created_at`. There is **no member binding** on the session.
- **CheckIn**: `location_id`, `member_id`, `qr_session_id`, `checked_in_at`, `source` (`qr-session`).

## 8. Compatibility with the tenant model

QRSession and CheckIn both carry `organization_id` and are reachable only through the tenant-scoped data layer, exactly like members, memberships, and payments. This keeps attendance on the same isolation boundary as the rest of the product.
