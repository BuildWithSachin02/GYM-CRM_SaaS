# Development Roadmap — Gym Management + CRM SaaS

## 1. Guiding order

Build vertical slices, each one production-quality and tenant-safe, before moving to the next. Foundational cross-cutting concerns (tenancy, auth, authorization, audit) are established in Phase 1 and reused by every module. No business feature is built before the foundation described in this document.

## 2. Phase 0 — Foundation (done / in progress)

- Next.js 16 App Router + TypeScript foundation — ✅ done.
- Tailwind v4 + shadcn/ui configured — ✅ done.
- Product & architecture documentation — this step.
- Remaining Phase 0 work:
  - Initialize Prisma (`prisma init`), add `@prisma/client`, implement the tenant-scoped data layer and Prisma client singleton.
  - Add authentication + session and the tenancy resolver.
  - Implement RBAC framework (roles/permissions/scope) and the authorization guard.
  - Add the audit log writer.
  - Stand up a test DB + test harness.

**Verification gate for Phase 0:** tenant isolation and authorization integration tests pass; `npm run lint` and `npm run build` pass.

## 3. Phase 1 — Organizations, locations, users, members

- Organization + location management (create, configure, multiple locations).
- Users, roles, role assignment at org/location scope.
- Member CRUD, membership status, primary location.
- Seeding of the demo tenant (King's Gym) via generic organization creation — no hardcoded tenant logic.

**Define for reuse:** the tenant-scoped service patterns used by all later modules.

## 4. Phase 2 — Membership plans & lifecycle

- Plans (org-owned): create/archive, billing interval, price (minor units).
- Membership lifecycle: start, renew, freeze, cancel, expiry + grace.
- Freeze windows and prorated math; membership state vs payment state independence.

## 5. Phase 3 — Manual payments

- Record manual payment (amount, method, reference, captured-at) against a membership.
- Balance/outstanding computation (server-side).
- Refund / void; audit trail; idempotency.
- Reports seed: revenue by period, active members, plan distribution.

## 6. Phase 4 — QR attendance

- QRSession issue/redeem, authenticated member flow, short-lived tokens, hash-at-rest.
- Check-in recording, duplicate window, membership validation.
- Attendance log + per-member attendance report.
- Staff-assisted check-in fallback.

## 7. Phase 5 — Leads & CRM

- Lead creation with sources (website/instagram/facebook/whatsapp/google/walk-in/manual).
- Pipeline stages + validated transitions.
- Lead activities, follow-ups, appointments.
- Ownership/reassignment (audited).
- Conversion to member (unique `converted_member_id` guard).

## 8. Phase 6 — Notifications

- Notification entity + inbox channel, read/unread, delivery status.
- Notification rendering in the staff UI.

## 9. Phase 7 — Automation engine

- Outbox + dispatcher + job runner with retries/idempotency/dead-letter.
- Rule builder UI for TRIGGER→CONDITIONS→ACTIONS.
- Seed triggers (lead.created, followup.due, membership.expiring, payment.recorded).
- Actions: create_activity, send_notification, create_followup, update_field.

## 10. Phase 8 — Reports

- Revenue, active members, plan distribution, attendance, lead funnel (org-scoped, `report:read`).
- Period selection + location timezone handling.

## 11. Phase 9 — Auditing, hardening, multi-tenant ops

- Expand audit coverage; add admin alerting.
- Rate limiting, CSP, backup/restore drills.
- Automation/notification observability.

## 12. Phase 10 — Integrations (future)

- WhatsApp (verified webhooks + messaging adapter).
- Instagram/Facebook (source attribution + inbound DMs).
- Email channel.
- Payment gateway adapter (additive; manual recording remains).
See `INTEGRATIONS.md` for design; these are deliberately post-MVP.

## 13. Cross-cutting dependencies per phase

| Foundation | Enables | Defined in |
|------------|---------|------------|
| Tenancy layer | All org data | `ARCHITECTURE.md`, `AUTHORIZATION.md` |
| RBAC | All module permissions | `AUTHORIZATION.md` |
| Audit log | Payments, memberships, leads | `DATABASE_DESIGN.md` |
| Notification model | Automation actions, reminders | `AUTOMATION_ENGINE.md` |
| Outbox/dispatcher | Automation, webhook intake | `AUTOMATION_ENGINE.md` |

## 14. Definition of done (per phase)

- All module business rules implemented server-side and tested.
- Tenant isolation + authorization tested for the module.
- Audit coverage for money/security events in the module.
- `npm run lint` and `npm run build` pass.
- Documentation updated to reflect any schema/behavior changes.
