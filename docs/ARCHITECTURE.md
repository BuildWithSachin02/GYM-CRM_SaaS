# Architecture — Gym Management + CRM SaaS

## 1. Overview

A multi-tenant web application built on **Next.js 16 (App Router) + TypeScript**, styled with **Tailwind CSS v4 + shadcn/ui**, persisted in **PostgreSQL via Prisma ORM**. It is a single codebase, single deployment serving all tenants, with tenancy enforced by a shared database model (shared-schema, tenant-key isolation).

### Stack (current, verified)
- Next.js 16.3.4 (App Router, `src/` directory, Turbopack)
- React 19.2.8
- TypeScript 5.9.3
- Tailwind CSS 4.3.3 (v4 — no `tailwind.config.*`)
- shadcn/ui configured (`base-nova` style, Base UI primitives)
- ESLint 9 flat config
- PostgreSQL + Prisma (Prisma devDependency installed but **not initialized**)

## 2. Architectural principles

- **Thin server-first client.** The Next.js server (Server Components + Server Actions / route handlers) is the only place that resolves identity and tenancy.
- **Tenant isolation by construction.** Every organization-owned table has a tenant key; the data-access layer always scopes queries by the tenant resolved from the session — never from request input.
- **No client trust.** Client requests may carry IDs and statuses, but authorization, tenancy, and business-rule enforcement happen server-side.
- **Layered modules.** Business logic lives in server-side service modules, not in components.
- **Extensibility chokepoints.** Automation, notifications, and integrations are designed as pluggable adapters.

## 3. Logical layers

```
┌─────────────────────────────────────────────┐
│  UI (React Server Components + shadcn/ui)   │
└────────────────────┬────────────────────────┘
                     │ (Server Actions / Route Handlers)
┌────────────────────▼────────────────────────┐
│  Application / Controller layer             │  ← parses input, calls services
├─────────────────────────────────────────────┤
│  Service layer (domain logic)               │  ← tenancy + authorization + rules
├─────────────────────────────────────────────┤
│  Data-access layer (Prisma)                 │  ← tenant-scoped queries
├─────────────────────────────────────────────┤
│  PostgreSQL (Prisma Migrate)                │
└─────────────────────────────────────────────┘
```

Cross-cutting: **Authorization middleware**, **tenancy resolver**, **auth context**, **audit log**, **automation/dispatcher**, **notification dispatcher**.

## 4. Tenancy model

- **Organization** is the tenant and the SaaS customer account.
- A tenant key (`organization_id`) is stored on the tenant's own row and on every organization-owned resource.
- Postgres is shared across tenants (shared schema with per-row tenant key, plus a covering index). This keeps operations simple for the small-to-mid gym market and is compatible with future sharding by organization.
- The tenant is resolved server-side from the authenticated session. **The client never supplies the tenant directly** for reads/writes; where an ID is supplied it is validated to belong to the session's tenant before use.
- **Branch** is a location *inside* a tenant, not a second tenant: `Organization → Branch`, and every branch-owned record carries both keys. Branch ids arriving from a cookie, query string or form are treated as preferences and re-authorized on the server; branch is a scoping axis, never an isolation boundary (see `AUTHORIZATION.md` §5.5).
- The Branches module (`/dashboard/branches`) is a first-class module with dedicated `branches:*` permissions, not a Settings tab.

### Why not a database per tenant
For the target market (independent gyms/small chains), shared-schema is the pragmatic default: lower cost, simpler migrations, easy reporting. If a single customer needs hard isolation later, that becomes a provider-level feature; the domain model does not change.

## 5. Repository layout (current)

```
src/
  app/                    # Next.js App Router routes
    layout.tsx, page.tsx, globals.css
  components/ui/          # shadcn/ui components (button.tsx present)
  lib/utils.ts            # cn helper
prisma/                   # (future) schema.prisma, migrations
docs/                     # this documentation set
```

### Planned structure (for later features)
```
src/
  app/(dashboard)/...         # authenticated shell + routes
  components/                 # feature components
  lib/
    auth/                     # auth context, tenancy resolver, authorization
    db/                       # Prisma client singleton + tenant-scoped helpers
    domain/                   # service modules: members, plans, payments, leads...
    validators/               # request schemas (e.g. zod)
    audit/                    # audit writer
    automation/               # trigger/condition/action dispatcher
    notifications/            # channel adapters
  server/                     # route handlers / server actions
  types/                      # shared domain types
```

## 6. Request flow (server-first)

1. Client request (Server Action or route handler) → middleware/session extracts authenticated User.
2. **Tenancy resolver** derives the Organization from the session.
3. **Authorization** checks the user's role+scope can perform the action.
4. **Branch scope resolver** derives WHERE the user may operate (`getBranchAccess()` from session + `gym_branch` cookie, re-validated server-side) and narrows every domain query with a branch filter (`getBranchFilter()` / `getBranchFilterForRequest()` / `branchFilterWhere`). An explicit `?branch=<id>` is re-authorized server-side and fails closed with 404. Branch-attributed metrics use the `exact` filter so no organization-wide row is ever counted on a branch card.
5. Input is validated and sanitized.
6. Service enforces business rules and writes via the tenant-scoped data layer.
7. Audit events are written for dangerous mutations.
8. Relevant automation triggers and notification dispatches are enqueued.

## 7. Automation & notifications (architecture)

- **Automation Rule** = TRIGGER → CONDITIONS → ACTIONS.
- A **dispatcher** ingests domain events (via an outbox pattern) and evaluates matching rules.
- Actions are **idempotent** (keyed by a dedupe ID) and **retryable**; failures land in a dead-letter store.
- Long-running work uses background jobs (queue/worker) rather than blocking the request path.
- **Notification** uses channel adapters behind an interface; `inbox` is the first channel, `email`/`whatsapp` are later adapters. See `INTEGRATIONS.md`.

## 8. Security architecture

Summarized here; full detail in `AUTHORIZATION.md` and `SECURITY.md`.

- Session-based auth with server-held authority.
- RBAC: Role × Scope (organization / branch) → permission set; on top of the catalog, `UserBranch` scopes *where* a user may operate (see `AUTHORIZATION.md` §5.5).
- Branch is never a tenant boundary: data is org-scoped AND branch-filtered, fail-closed when a restricted user has no assignments.
- Every mutation re-runs authorization.
- Tenant key always derived server-side.
- Audit log for security- and money-relevant events.
- Secrets via environment variables only.
- Webhooks (future) verified by signature; credential stores encrypted.

## 9. Concurrency and data integrity

- Money-related writes are transactional (Prisma transactions).
- Idempotency keys prevent duplicate payment or automation effects.
- Optimistic versioning where appropriate to avoid lost updates on shared entities.

## 10. Deployment considerations

- Stateless application servers (session data externalized to Postgres, and later optional Redis for queues).
- Schema migrations via Prisma Migrate, run as a release step before rollout.
- Backups and point-in-time recovery for the shared Postgres.
- Environment-specific configuration through environment variables; no secrets in the repository.

## 11. Cross-cutting consistency rules

- All timestamps stored in UTC; rendered in the organization's timezone (a Branch has no independent timezone — it inherits `Organization.timezone`).
- All monetary values stored as integer minor units (e.g. cents) to avoid float errors; display formatted per currency.
- Tenant-scoped queries must be the default; any code path that could read across tenants requires explicit review.
