# Product Requirements — Gym Management + CRM SaaS

## 1. Product summary

A production-grade, multi-tenant SaaS that combines gym operations management with a member-acquisition CRM. The product is sold to independent gyms and small gym chains. Each customer is an **Organization** (the tenant); an organization can own one or more **Locations** (gyms). King's Gym is the first demo tenant but nothing in the architecture is hardcoded to it.

The product addresses three connected workflows:

1. **Operations** — members, membership plans, membership lifecycle, manual payments, QR attendance.
2. **Sales / CRM** — leads, lead sources, pipeline, activities, follow-ups, appointments.
3. **Growth automation** — automation rules (TRIGGER → CONDITIONS → ACTIONS), notifications, reports.

## 2. Goals and non-goals

### Goals
- Multi-tenancy by design from day one; every organization-owned resource is tenant-isolated.
- Authorization enforced **server-side**; never trust client-supplied identity.
- Manual payment recording as the first monetization primitive (no payment gateway yet).
- Authenticated, short-lived QR attendance (no member ID baked into a static QR).
- Lead pipeline with source attribution and follow-up automation.
- Clean foundation for future WhatsApp, Instagram/Facebook, and payment-gateway integrations.

### Non-goals (initial scope)
- No online payment gateway interaction (manual recording only).
- No external social/WhatsApp sending (outbound notifications are internal first; channels are a later phase).
- No public member self-service portal (out of scope for phase 1, revisited later).

## 3. Personas and roles

| Role | Scope | Description |
|------|-------|-------------|
| **Owner / Admin** | Organization | Full access: settings, users, roles, billing, all modules. |
| **Manager** | Organization or Location | Operates members, plans, payments, attendance, leads, reports; no organization settings or user admin. |
| **Front Desk / Staff** | Location | Handles members, payments, attendance, leads, appointments, follow-ups. |
| **Trainer** | Organization or Location | Manages own appointments, member check-ins, limited member view. |
| **Member** (portal, later) | Self | Uses authenticated QR check-in; cannot access staff data. |

Roles are granted as **role × scope**: a role binds a set of permissions to an organization or to a specific location.

## 4. Domain terminology

- **Organization** — the SaaS customer account and the unit of tenancy.
- **Location / Gym** — a physical site owned by an organization (1..n).
- **User** — a staff account that logs in and belongs to an organization.
- **Member** — a person in the organization's gym ecosystem (organization-owned, assigned to a primary location).
- **Trainer** — a user whose role includes training permissions.
- **Membership Plan** — a priced, organization-owned product (e.g. "Monthly", "Annual").
- **Membership** — a member's active subscription to a plan (a lifecycle object, not a plan).
- **Payment** — a manually recorded payment against a membership or plan.
- **Lead** — a potential member with an attributable source and a pipeline stage.
- **Lead Source** — where a lead came from (website, Instagram, Facebook, WhatsApp, Google, walk-in, manual).
- **Lead Activity** — a CRM touchpoint on a lead (note, call, message, visit).
- **Follow-up** — a scheduled activity to re-engage a lead.
- **Appointment** — a scheduled meeting/visit with a lead or member.
- **Attendance / Check-in** — a membership validated against a short-lived QR session.
- **Automation Rule** — TRIGGER → CONDITIONS → ACTIONS configuration.
- **Notification** — an outbound message (internal inbox, and later WhatsApp/email).
- **Audit Log** — an immutable, tenant-scoped trail of security- and money-relevant events.

## 5. Functional requirements by module

### 5.1 Organizations, locations, users

- FR-ORG-01 Onboarding creates an organization and a first Owner user.
- FR-ORG-02 An organization can have many locations; each location has name, address, timezone, and status.
- FR-ORG-03 Users belong to an organization; a user may have roles at multiple locations within the same organization.
- FR-ORG-04 Roles are assignable at organization or location scope.
- FR-ORG-05 Deactivated users cannot authenticate or hold sessions.

### 5.2 Members

- FR-MEM-01 A member must belong to exactly one organization and have a primary location.
- FR-MEM-02 Member identity (name, contact, photo) is managed within the organization.
- FR-MEM-03 A member has a stable canonical key (UUID, internal-only). The human-facing **Member Code** (`MEM-0001`, org-scoped, assigned by the server and never recycled) is a **display/organizational identifier only**: it is shown to staff across membership, payment, attendance, CRM and export surfaces, and may also be matched by staff search. It is **never** embedded in QR payloads, client URLs, or auth tokens, and it is never used as a foreign key or for authorization — the UUID remains canonical everywhere under the hood.
- FR-MEM-04 Member status: `active`, `frozen`, `inactive`.
- FR-MEM-05 A Member Code is unique **per organization** (the DB enforces `(organization_id, member_code)`); codes have no 9999 cap and are never reused after assignment, even when a member is archived.
- FR-MEM-06 Member phone is **not unique** — even within an organization. Two members may share a phone (family members). Duplicate detection on create/update is a **warning only** (STRONG: same normalized name AND same phone; WEAK: same name), never a hard block. Email remains org-unique.
- FR-MEM-07 Member search includes the Member Code as a matchable and displayable term alongside name and phone (same-name members are disambiguated by their codes).

### 5.3 Trainers

- FR-TRN-01 A trainer is a user with trainer role permissions.
- FR-TRN-02 Trainers are assignable to locations and members.

### 5.4 Membership plans

- FR-PLN-01 Plans are organization-owned, not global.
- FR-PLN-02 A plan has: name, billing interval (`monthly`/`quarterly`/`annual`/`custom`), price, currency, active flag.
- FR-PLN-03 Plans can be archived, never hard-deleted while referenced.

### 5.5 Membership lifecycle

- FR-MS-01 A membership: `draft` → `active` → (`frozen` | `expired` | `cancelled`).
- FR-MS-02 Start/end dates, renewals, and freeze windows are tracked per membership.
- FR-MS-03 Membership states and payment state are independent (a membership can be active with an outstanding balance).
- FR-MS-04 Expiry is derived from the latest payment covering the current period, with a grace period.

### 5.6 Manual payments

- FR-PAY-01 Payment is recorded manually by staff with amount, method (`cash`/`card`/`transfer`/`upi`), reference, and captured-at time.
- FR-PAY-02 Payments must be attributable to an organization, a membership, and a recording user.
- FR-PAY-03 Payment amounts, methods, and statuses are authoritative from the server, never from the client.
- FR-PAY-04 Payment status: `recorded`, `refunded`, `voided`.
- FR-PAY-05 Every payment mutation writes an audit log entry.

### 5.7 QR attendance

- FR-QR-01 Attendance uses an **authenticated member flow** plus a **short-lived gym QR session/token**.
- FR-QR-02 A static QR must never contain a member ID or a member code.
- FR-QR-03 A check-in records: member, location, timestamp, and the QR session/token identifier.
- FR-QR-04 Duplicate check-in within a configurable window is rejected.
- FR-QR-05 Attendance validates that the member has an active membership.

### 5.8 Leads

- FR-LD-01 A lead is organization-owned and belongs to a location and an owner (user).
- FR-LD-02 Lead source is required and drawn from a fixed set with free-text detail.
- FR-LD-03 Lead pipeline follows a lifecycle with stage transitions.
- FR-LD-04 Leads can be converted, at which point a Member is created and linked.

### 5.9 Predefined lead sources

`website`, `instagram`, `facebook`, `whatsapp`, `google`, `walk-in`, `manual`.

A source may carry supplemental detail (e.g. ad/post/UTM) for attribution.

### 5.10 Lead pipeline and activities

- FR-LD-PLN-01 Stages: `new`, `contacted`, `visit-scheduled`, `visit-done`, `converted`, `lost`, `unqualified`.
- FR-LD-ACT-01 Activities have a type (note, call, message, visit, email) and a timestamp.
- FR-LD-FU-01 A follow-up is a scheduled activity with a due datetime and an assignee.

### 5.11 Appointments

- FR-APP-01 An appointment has a lead or member, a staff assignee, a start/end time, a location, and a status (`scheduled`, `completed`, `cancelled`, `no-show`).

### 5.12 Automation

- FR-AUT-01 Rules are organization-owned and follow **TRIGGER → CONDITIONS → ACTIONS**.
- FR-AUT-02 Triggers and conditions reference entity events; actions are typed effects (create activity, send notification, update field, create follow-up).
- FR-AUT-03 Rules support enable/disable and an evaluation status.
- FR-AUT-04 Execution is idempotent and supports retries with a dead-letter path.

### 5.13 Notifications

- FR-NOT-01 Notifications are organization-owned and targeted at a user, or at a lead/member mailbox within the org.
- FR-NOT-02 Delivery status is tracked; failed sends are retryable.
- FR-NOT-03 Channel is extensible: `inbox` first, then `email`, `whatsapp`.

### 5.14 Reports

- FR-RPT-01 Reports aggregate across organization data only (never cross-tenant).
- FR-RPT-02 Initial reports: revenue by period, active members, plan distribution, attendance, lead conversion funnel.

### 5.15 Audit log

- FR-AUD-01 Log security, permission, payment, and membership-lifecycle events.
- FR-AUD-02 Entries are append-only, tenant-scoped, and include actor, action, entity, and before/after where relevant.

## 6. Critical business rules (summary)

- BR-01 Every org-owned table carries a tenant key; every query scoped by the authenticated tenant.
- BR-02 Client-supplied `organizationId`, `role`, `memberId`, `payment status`, and `attendance identity` are ignored in favor of server resolution.
- BR-03 Payments update server-calculated balances; the client only submits intent.
- BR-04 Attendance identity comes from a server-issued short-lived QR session, not from a static QR or a client-provided member ID.
- BR-05 Leaderboard/ownership: a lead has exactly one current owner; reassignment is audited.
- BR-06 Currency is fixed per organization and immutable after first payment.
- BR-07 Deletion is soft (archived/deactivated) for money- and relationship-related entities.

## 7. Edge cases

- EC-01 Freeze mid-billing-cycle: compute prorated end date, not a charge.
- EC-02 Overlapping freeze windows must not double-count days.
- EC-03 Duplicate QR scan in the scan window must not double-check-in.
- EC-04 QR token expiry while offline must be recoverable by re-authentication.
- EC-05 A lead converted twice must be prevented by a uniqueness guard; the member link is set once.
- EC-06 An automation action that depends on a deleted entity must no-op, not crash.
- EC-07 Payment recorded for a cancelled membership must be rejected or strictly flagged.
- EC-08 Timezone differences between locations affect "same day" attendance windowing; use location timezone.
- EC-09 Deleting a source/owner referenced by leads blocks delete, requires reassignment or archive.

## 8. Non-functional requirements

- NFR-01 Tenant isolation guarantees: an authenticated user can never read/write another tenant's rows.
- NFR-02 Every dangerous mutation is authorization-checked and audited.
- NFR-03 Community-tier security hygiene: secrets only in environment variables, never in code or client bundles.
- NFR-04 Automation and notifications tolerate transient failures with retries and idempotency.
- NFR-05 All times stored in UTC; display in location timezone.
