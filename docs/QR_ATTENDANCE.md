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

Staff search on the attendance/manual check-in screen also matches the member's **Member Code** (`MEM-0042`) and shows it next to the member name, so members with identical names are disambiguated by staff in seconds. The code is a **display/search convenience only** — the check-in still binds the resolved member UUID, and the code is never read from a client-supplied string or used for authorization.

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

## 9. Trusted devices (faster repeat check-ins)

To avoid re-searching the member list on every scan, a browser can *remember* the member who just checked in:

- The member **explicitly opts in** via the "Remember this device for faster QR check-ins." checkbox on the check-in screen — the box is **unchecked by default**, and a device is never associated implicitly.
- A random 32-byte **token** is generated; only its SHA-256 **hash** is stored in `MemberDevice` (`token_hash` unique). The raw token lives only in a secure, HttpOnly cookie (`gym_device`, path `/attendance/qr`, 60-day max age, SameSite=Lax, Secure in production). The cookie **never encodes the memberId or organizationId**.
- A device is **identification convenience only**. It never bypasses a single server-side check; every scan — remembered or not — re-validates the QR session, tenancy, member status, duplicate rules and membership coverage. Both paths converge on the same decision (`decideQrScan` in `src/lib/qr-attendance.ts`).
- Revocation: at most 3 active devices per member (oldest auto-revoked on overflow). Staff can revoke any device from the member profile; the member may then simply check in again via search. A revoked/missing/other-gym device makes the scan **silently fall back to the member-search flow**.
- Device rows cascade-delete with their member (no orphaned hashes survive a member reset). See `DATABASE_DESIGN.md`.

### 9.1 Identity confirmation before remembering

Before a device is ever created the member is shown an explicit **confirmation screen** (`Confirm your identity`): their full name, a **masked phone** (`maskPhone`, only the last four digits — the raw number is never sent to the browser) and the current plan label when today is covered. The member's **Member Code** may also be shown as an identity hint — it is display-only and never sent into the QR flow. The "Remember this device" checkbox lives **on the confirmation screen, unchecked by default**, and resets to unchecked before every selection. Selecting a name from search alone never creates a device; only confirmation does.

### 9.2 "Not you? Report wrong identity"

If a device was bound to the wrong person, the member can hit **"Not you? Report wrong identity"** (shown on the checking/result screens only when a device is involved — remembered or just created):

- The server revokes **only the current browser's device** (identified from the device cookie) and clears the cookie, so the very next scan falls back to member search. It is idempotent and performs **no** attendance writes.
- It **never** creates, transfers, or deletes a check-in. Already-recorded wrong check-ins stay for staff to fix; the member reports at reception.
- An audit entry (`qr.device_revoked`, reason `member_wrong_identity`) is recorded in the correct tenant context.

### 9.3 Staff correction of a wrongly attributed check-in

OWNER/ADMIN (with `attendance:record`) see an **Actions / Correct** button on `QR_SESSION` rows in the member attendance page. A dialog reassigns the existing `CheckIn` to the correct member:

- The existing row is **reassigned** (`memberId` updated) — never deleted, never duplicated. The `@@unique([organizationId, memberId, dayKey])` constraint keeps one check-in per member per day, and reports/history recompute automatically.
- The server re-validates everything: same organization, different member, valid non-deleted target, no existing check-in for the target on that day, and the check-in must **not** be linked to an approved `AttendanceRequest` (those are never reassigned).
- A P2002 (duplicate) race is caught defensively and surfaced as `duplicate_day`.
- Every correction writes an **audit trail** (`attendance.checkin_member_corrected`, with before/after member and optional staff reason).

## 10. Expired membership → pending attendance request

When the member's membership does not cover the scan day (EXPIRED / CANCELLED / PAUSED / UPCOMING / none), no CheckIn is created. Instead:

1. A **PENDING `AttendanceRequest`** is created (at most one per member per org-timezone day via a unique key). It records the original day, the QR session, and the requested-at instant.
2. The member sees *"Your membership has expired. Please contact the gym reception."* and *"Your attendance request is pending gym approval."*, and is **not** blocked from a future legitimate scan.
3. Every active **OWNER/ADMIN** receives an in-app notification (`NotificationType.ATTENDANCE_REQUEST`, link to `/dashboard/attendance/requests`), reusing the existing Notification inbox. Notifications are staff-facing only — member-facing push/WhatsApp delivery is out of scope (see `PRODUCT_REQUIREMENTS.md`).
4. Acting staff open **Attendance Requests** to approve or reject.

**Approval** converts the request into a normal completed `CheckIn` (same `dayKey`, original `requestedAt` as the check-in time, source `QR_SESSION`) — never a separate `PENDING` state on CheckIn. Approval **re-validates everything server-side**: still pending, member still active, no existing check-in for that day, and the *current* membership coverage must genuinely include the **original request day**. A still-expired membership is rejected with *"Membership is still expired. Renew the membership before approving this attendance."* — so the owner renews the membership first, then approves. An outstanding balance never blocks approval.

**Rejection** records an optional staff reason and leaves the status REJECTED; the member's next scan on a covered day works normally (and a repeat scan of an already-rejected request signals "check-in not approved").

## 11. Result outcomes of a scan

A scan resolves to exactly one of (see `QrScanPlan` / `QrCheckinResult`):

| Outcome | Meaning |
| --- | --- |
| `member_not_active` | member record not ACTIVE — never recorded, no request |
| `already_checked_in` | duplicate for the (member, org-day) — idempotent reply |
| `check_in` | membership covers today → normal `CheckIn` |
| `request_attendance` | no coverage today → `PENDING` request + staff notification |

Memory device auto-check-in returns the same outcomes; a missing/revoked/wrong-gym device returns `code: "device_not_found"` so the UI silently restores the member-search flow.
