# Database Design — Gym Management + CRM SaaS

## 1. Guiding constraints

- **PostgreSQL via Prisma ORM.** Prisma is installed as a devDependency but **not initialized**; no `schema.prisma`, no `@prisma/client`, no migrations, no database (yet).
- **Shared-schema, tenant-key isolation.** Every organization-owned table carries `organization_id`.
- **Tenant key derived server-side** — never trusted from the client.
- **Money as integer minor units.**
- **Time in UTC.**
- **Multi-tenant from day one**; no schema construct is specific to King's Gym (the first demo organization is seeded as plain data, not hardcoded).
- **Preserve history.** Historical financial, attendance, and audit records must not disappear accidentally.

## 2. Locked design decisions

These decisions are binding before creating `schema.prisma`.

### D-01 Primary keys
Use **UUID** as the PK strategy consistently across all entities. Do not mix `BigInt` and `UUID` unless a specific technical requirement is documented later. Opaque identifiers and internal FKs both use the entity UUID.

### D-02 User / Member / Lead identity uniqueness
- `User.email` is **globally unique** — it is the SaaS login identity.
- `Member` and `Lead` email/phone must **NOT** be globally unique. Duplicate detection/uniqueness is scoped to the **organization** where appropriate (partial unique indexes).

### D-03 JSON
Use **PostgreSQL JSONB** for flexible structured data: `AutomationRule` trigger/conditions/actions, `AutomationJob.error`, `AuditLog.before/after`, and report snapshots. No freeze data is stored as JSON (see D-08). In Prisma, JSONB is represented by the `Json` field type (Prisma maps `Json` to PostgreSQL `jsonb`).

### D-04 Polymorphic references
Avoid ambiguous polymorphic references where possible.
- **Appointment** subject: concrete nullable FKs `lead_id` and `member_id` plus a **database CHECK constraint** requiring exactly one non-null.
- **Notification** recipient: concrete nullable FKs per recipient kind (e.g. `user_id`, `lead_id`, `member_id`) plus a CHECK constraint for exactly one non-null.
- **Prisma limitation documented:** Prisma cannot express "exactly one of these nullable FKs is non-null" or arbitrary CHECK constraints natively. They must be added via raw SQL in the migration (`db.execute`) after `prisma migrate` scaffolded the columns.

### D-05 Multi-tenancy
- `organization_id` is required on **every organization-owned table** (non-nullable FK).
- All organization-owned queries and mutations are tenant-scoped.
- Never trust `organization_id` supplied by the client; it is resolved server-side from the session.

### D-06 Locations / member attendance
- `Member.primary_location_id` is **nullable**.
- A member may attend multiple locations when the organization has multiple locations.

### D-07 QR sessions
- QR sessions are **reusable attendance points for a gym/location**, not per-member sessions.
- Use a **cryptographically random short-lived token**.
- Store **only the token hash** (`token_hash`), which must be **unique**.
- The QR/token **never contains a member ID**; member identity comes from the authenticated member flow.
- Add indexes for expiration/cleanup.

### D-08 Membership freezes
Use a separate **`MembershipFreeze`** table instead of storing freeze history as JSON. This supports reporting over freeze periods.

### D-09 Billing
- Support standard billing intervals plus custom duration.
- If `interval = custom`, `duration_days` is **required**.
- If interval is not custom, `duration_days` must be **null**.
- Enforce via database CHECK constraints where practical **and** application validation.

### D-10 Soft deletion
- Use soft deletion/archive semantics where appropriate (plan, member, lead, user, location).
- Prefer **RESTRICT** for important historical references so financial, attendance, and audit history cannot accidentally disappear.
- Delete behavior is defined explicitly for every important foreign key (see §7).

### D-11 Enums
Use **PostgreSQL native enums** for stable domain states: membership status, payment status, appointment status, lead stage, and the lead source.
- Document the migration requirements when enum values change (additive before use; value removal requires a data pass — see §7).

### D-12 User role/location
- **Location-scoped** roles **require** a location.
- **Organization-scoped** roles must **not** require a location.
- Enforce **primarily in application/service-layer validation** and add database constraints where practical (a CHECK constraint on `UserRole` expressing "scope=location ⟹ location_id is not null").

### D-13 Lead source canonical form
- One canonical `LeadSource` representation across the system.
- `Member.signup_source` uses the **same canonical source terminology** as `Lead.source` so values cannot drift (same native enum / lookup).

## 3. Tenancy backbone

Every entity marked *org-owned* carries a non-null `organization_id`. The tenant key is always bound through the data-access layer, never from client input.

### Identifiers
- All primary keys are UUID.
- No numeric sequential IDs are used as public identifiers or embedded in QRs/URLs.

## 4. Core entities and relationships

### 4.1 Organization *(tenant)*
- id (UUID) PK, name, slug, currency, timezone, status (native enum: `active`/`sandbox`/`suspended`), created/updated.
- Seeding is generic; King's Gym is only the first demo row, not hardcoded.

### 4.2 Location (Gym) — org-owned
- id (UUID) PK, organization_id → Organization, name, address, timezone, status (`active`/`inactive`), deleted_at (nullable, soft-delete), created/updated.
- Organization has 1..n locations.

### 4.3 User — org-owned (staff account)
- id (UUID) PK, organization_id → Organization, name, email (**globally unique**), password_hash (future), auth_provider_id (nullable), status (`active`/`deactivated`), created/updated.
- Relationship to locations is via **UserRole** (role × scope).

### 4.4 Role / Permission (RBAC)
- **Role**: id (UUID) PK, organization_id (nullable ⇒ system default), name, key, is_system, permissions (JSONB array of permission keys), created/updated.
- **UserRole**: id (UUID) PK, user_id → User, role_id → Role, scope (native enum: `organization`/`location`), location_id (nullable; required when scope=location; CHECK constraint per D-12), created/updated.

### 4.5 Member — org-owned
- id (UUID) PK, organization_id → Organization, primary_location_id → Location (**nullable**), name, email (org-scoped), phone (org-scoped), photo_url (nullable), status (`active`/`frozen`/`inactive`), signup_source (nullable, canonical `LeadSource` enum per D-13), deleted_at (nullable), created/updated.
- Relationship to plans is via **Membership**.

### 4.6 Trainer — org-owned
- id (UUID) PK, organization_id → Organization, user_id → User, member_id → Member (self-reference), bio, specialties (JSONB), created/updated.

### 4.7 MembershipPlan — org-owned
- id (UUID) PK, organization_id → Organization, name, billing_interval (native enum: `monthly`/`quarterly`/`annual`/`custom`), price_minor (integer), currency, duration_days (nullable; required iff custom per D-09), status (`active`/`archived`), created/updated.

### 4.8 Membership — org-owned
- id (UUID) PK, organization_id → Organization, member_id → Member, plan_id → MembershipPlan, status (native enum: `draft`/`active`/`frozen`/`expired`/`cancelled`), start_date, end_date, renews_automatically (bool), created/updated.
- Money and state are independent: a membership can be active with outstanding balance.
- Active-member uniqueness: a member may not hold two simultaneous active memberships of the same plan (partial unique index, see §5; default disallow).
- Freeze periods live in **MembershipFreeze** (D-08).

### 4.9 MembershipFreeze — org-owned
- id (UUID) PK, organization_id → Organization, membership_id → Membership, frozen_from, frozen_to, reason (nullable), created/updated.
- Supports reporting over freeze periods (e.g. total frozen days per membership).
- NULL `frozen_to` indicates an ongoing freeze; end-date math uses location timezone only at display.

### 4.10 Payment — org-owned
- id (UUID) PK, organization_id → Organization, membership_id → Membership, member_id → Member, amount_minor (integer), currency, method (native enum: `cash`/`card`/`transfer`/`upi`), reference (nullable), status (native enum: `recorded`/`refunded`/`voided`), recorded_by_user_id → User, captured_at, created/updated.

### 4.11 QR Attendance
- **QRSession** (reusable location-based token, D-07): id (UUID) PK, organization_id → Organization, location_id → Location (the attendance point), token_hash (**unique**, only the hash is stored), expires_at, revoked_at (nullable), created_by_user_id → User, created_at.
- **CheckIn**: id (UUID) PK, organization_id → Organization, location_id → Location, member_id → Member, qr_session_id → QRSession, checked_in_at, source (`qr-session`), created_at.
- A QRSession is a short-lived random token for a location; many members may check in against it during its validity. Member identity comes from the authenticated member flow, never from the QR.

### 4.12 Lead — org-owned
- id (UUID) PK, organization_id → Organization, location_id → Location, owner_user_id → User (nullable), name, email (org-scoped), phone (org-scoped), source (canonical `LeadSource` enum, D-13), source_detail (nullable), current_stage (native enum), engaged_at (nullable), converted_on (nullable), converted_member_id → Member (nullable, unique), deleted_at (nullable), created/updated.

### 4.13 LeadSource (canonical, native enum, D-13)
- `website`, `instagram`, `facebook`, `whatsapp`, `google`, `walk-in`, `manual` (+ optional `source_detail` free text).
- Used by `Lead.source` and `Member.signup_source`.

### 4.14 LeadStage (native enum, D-11)
- `new`, `contacted`, `visit-scheduled`, `visit-done`, `converted`, `lost`, `unqualified`.
- Stage transitions validated server-side (see `LEADS.md`).

### 4.15 LeadActivity — org-owned
- id (UUID) PK, organization_id → Organization, lead_id → Lead, type (native enum: `note`/`call`/`message`/`visit`/`email`), body, occurred_at, created_by_user_id → User.

### 4.16 FollowUp — org-owned
- id (UUID) PK, organization_id → Organization, lead_id → Lead, assignee_user_id → User, due_at, status (`open`/`done`/`dismissed`), reminder_sent_at (nullable), created/updated.

### 4.17 Appointment — org-owned
- id (UUID) PK, organization_id → Organization, location_id → Location, **lead_id (nullable)**, **member_id (nullable)**, staff_user_id → User, starts_at, ends_at, status (native enum: `scheduled`/`completed`/`cancelled`/`no-show`), notes (nullable), created/updated.
- D-04: exactly one of `lead_id`/`member_id` non-null, enforced by CHECK constraint (raw SQL).

### 4.18 AutomationRule — org-owned
- id (UUID) PK, organization_id → Organization, name, enabled, trigger (JSONB), conditions (JSONB), actions (JSONB), dedupe_key_template, status (`active`/`paused`/`error`), created/updated. See `AUTOMATION_ENGINE.md`.

### 4.19 AutomationJob — org-owned
- id (UUID) PK, organization_id → Organization, rule_id → AutomationRule, entity_ref, dedupe_key, status (`pending`/`running`/`succeeded`/`failed`/`dead`), attempts, error (JSONB nullable), run_at, completed_at.

### 4.20 Notification — org-owned
- id (UUID) PK, organization_id → Organization, recipient_type (`user`/`lead`/`member`), **recipient concrete FKs**: user_id (nullable), lead_id (nullable), member_id (nullable) — D-04; channel (native enum: `inbox`/`email`/`whatsapp`), title, body, status (`queued`/`sent`/`failed`), sent_at (nullable), external_ref (nullable), created/updated.
- CHECK constraint: exactly one recipient FK non-null (raw SQL).

### 4.21 ReportSnapshot (optional) — org-owned
- id (UUID) PK, organization_id → Organization, report_key, period_start, period_end, payload (JSONB), generated_at.

### 4.22 AuditLog — org-owned
- id (UUID) PK, organization_id → Organization, actor_user_id → User (nullable), action, entity_type, entity_id, before (JSONB nullable), after (JSONB nullable), ip (nullable), occurred_at. Append-only; never updated/deleted.

## 5. Key relationships at a glance

```
Organization 1—n Location
Organization 1—n User
User n—n Role  (via UserRole, role × scope)
Organization 1—n Member (n—1 Location, primary_location nullable)
Organization 1—n MembershipPlan
Member 1—n Membership n—1 MembershipPlan
Membership 1—n MembershipFreeze
Member 1—n Payment  (Payment n—1 Membership)
Organization 1—n Lead (n—1 Owner User, n—1 Location)
Lead 1—n LeadActivity
Lead 1—n FollowUp
Lead 0..1 Member (converted)
Appointment n—1 (Lead | Member) [exactly one], n—1 Staff User
Organization 1—n AutomationRule 1—n AutomationJob
Organization 1—n Notification 0..1 (User | Lead | Member) [exactly one]
Organization 1—n QRSession (n—1 Location); Member 1—n CheckIn n—1 QRSession
Organization 1—n AuditLog
```

## 6. Index strategy (tenant-scoped)

- Composite index on every org-owned table prefixed by `organization_id`.
- **User**: unique `email` (global).
- **Member**: unique `(organization_id, email)` where email non-null (partial); unique `(organization_id, phone)` where phone non-null (partial); `(organization_id, status)`; `(organization_id, primary_location_id)`.
- **Membership**: `(organization_id, status)`; `(organization_id, member_id)`; **partial unique** for one active per (member, plan): `(organization_id, member_id, plan_id)` WHERE status IN (`draft`,`active`,`frozen`).
- **MembershipFreeze**: `(organization_id, membership_id)`; `(organization_id, frozen_from, frozen_to)` for reporting.
- **Payment**: `(organization_id, membership_id)`; `(organization_id, member_id)`; `(organization_id, captured_at)`.
- **CheckIn**: `(organization_id, location_id, checked_in_at)`; `(organization_id, member_id)`.
- **QRSession**: unique `token_hash`; `(organization_id, expires_at)` for cleanup; `(expires_at)` for expiry sweeps.
- **AutomationJob**: `(organization_id, status)`; unique `(organization_id, rule_id, dedupe_key)`.
- **AuditLog**: `(organization_id, occurred_at)`; `(organization_id, entity_type, entity_id)`.
- **Notification**: `(organization_id, status)`; `(organization_id, recipient`+kind`)` as needed.
- **Lead**: `(organization_id, current_stage)`; `(organization_id, source)`; `(organization_id, owner_user_id)`; unique partial `(organization_id, email)`/`(organization_id, phone)` for dup detection.

## 7. Data integrity, delete behavior, and enums

### Unique constraints (real business rules only)
- `User.email` globally unique (login identity).
- `QRSession.token_hash` unique.
- `Lead.converted_member_id` unique (a member maps to at most one lead).
- `AutomationJob (organization_id, rule_id, dedupe_key)` unique (idempotency).
- Partial unique for active membership per (member, plan) (see §6).
- Partial unique for org-scoped Member/Lead email/phone duplicate detection.

### Delete behavior (all explicit)
- Use **RESTRICT** (default) for all important historical references so financial, attendance, and audit history cannot vanish:
  - Payment → Membership, Member, User(recorder): RESTRICT.
  - CheckIn → Member, QRSession, Location: RESTRICT.
  - AuditLog → Organization, User(actor nullable): RESTRICT; audit rows are never deleted.
  - Lead → Member (`converted_member_id`): SET NULL or RESTRICT per conversion semantics — see remaining-ambiguity note.
  - Membership → Member, Plan: RESTRICT.
  - MembershipFreeze → Membership: RESTRICT (cascade only if membership deletion semantics say so; default RESTRICT).
  - LeadActivity/FollowUp → Lead: RESTRICT (or CASCADE on soft-delete path; default RESTRICT).
- **Soft delete** (`deleted_at`) for Location, Member, Lead, Plan, User (deactivate), not for money/audit records.
- Organization deletion: RESTRICT everywhere; an org is deactivated/suspended, never hard-deleted while history exists.

### Enums (native PostgreSQL)
- Native enums: Organization.status, UserRole.scope, Member.status, Membership.status, Payment.method, Payment.status, Appointment.status, LeadStage, LeadSource, LeadActivity.type (and any other stable state set).
- **Enum change migration requirements (documented):**
  - Adding a value: additive `ALTER TYPE ... ADD VALUE`; safe, but a new value cannot be used inside a single migration that also references it (run as separate migration).
  - Removing/reordering a value: Postgres cannot drop/reorder enum values inline. Requires ALTER TYPE with a new type + `USING` casts + dropping the old type, with a data backfill pass.
  - Renaming: similar migration with casts.
  - Prefer adding new states over mutating existing ones; coordinate with application validation.

## 8. Cross-tenant guard

Every join/aggregate is anchored on the tenant key first. No cross-organization data path exists. The data-access layer always adds `organization_id = <tenant>` from the server session.

## 9. Migration policy (future)

- Prisma Migrate; each migration reviewed for tenant-keyed indexes.
- Raw SQL (`db.execute`) used for CHECK constraints, partial unique indexes, and native enum management that Prisma's schema DSL cannot express.
- No destructive changes without a reviewed data path.
- Backfill / data-fix migrations are idempotent and batched.
- Enum changes follow §7 rules.

## 10. Explicit non-goals for now

- No public member portal tables (deferred).
- No lead-scoring model (can be added as a computed field later).
- No 3rd-party payment-provider tables yet (see `INTEGRATIONS.md`).
- No tables specific to King's Gym (demo data is seeded as regular rows).
