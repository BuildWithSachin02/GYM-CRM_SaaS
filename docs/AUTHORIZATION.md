# Authorization — Gym Management + CRM SaaS

## 1. Authorization model

**Server-side RBAC.** The client (browser) never decides who may act. Every read/write is re-authorized from the server's own view of the authenticated user, their roles, and their scopes.

Three concepts combine:

1. **Identity** — the authenticated User derived from the session (see `SECURITY.md`).
2. **Tenancy** — the Organization derived from the session, not from the client.
3. **Permission** — a granular, alphabetical-name activity (e.g. `members:create`, `payments:read`).

## 2. Role model

A **Role** is a named set of permissions. Roles are either system-provided defaults or organization-defined.

Default roles:

| Role | Scope | Typical permissions |
|------|-------|---------------------|
| Owner | Organization | All permissions, including organization:settings and user:manage |
| Manager | Organization / Location | All operational modules except organization:settings and user:manage |
| Front Desk / Staff | Location | members, payments:record, attendance, leads, appointments, follow-ups, notifications:read |
| Trainer | Organization / Location | appointments:self, members:read (limited), attendance:read |

A role is granted to a user via **UserRole** with an explicit **scope**:

- `scope = organization` ⇒ applies organization-wide.
- `scope = location` ⇒ restricted to a specific `location_id`.

A user may hold multiple roles; the effective permission set is the union across all their roles and scopes. For any action, the **most restrictive scope that grants the permission** applies; a location-scoped grant only authorizes within that location's data.

## 3. Permission catalog (representative)

Namespaces: `organization`, `user`, `membership.plan`, `membership`, `member`, `payment`, `attendance`, `lead`, `lead.activity`, `followup`, `appointment`, `automation`, `notification`, `report`, `audit`.

Examples:

| Permission | Scope-guarded data |
|------------|--------------------|
| `organization:settings:read/update` | Organization record |
| `user:list`, `user:create`, `user:update`, `user:deactivate` | Users |
| `role:manage` | Roles/UserRole |
| `member:create/read/update/freeze` | Members |
| `plan:create/read/update/archive` | Plans |
| `membership:create/read/update/cancel/freeze` | Memberships |
| `payment:create/read/refund/void` | Payments |
| `attendance:read`, `attendance:record` | Check-ins, QR sessions |
| `lead:create/read/update/assign/convert/reassign` | Leads |
| `lead.activity:create`, `followup:create/update` | CRM touches |
| `appointment:create/read/update` | Appointments |
| `automation:manage` | Rules + jobs |
| `notification:read/send` | Notifications |
| `report:read` | Reports |
| `audit:read` | Audit log |

## 4. Enforcement strategy

Every server entrypoint (Server Action / route handler) runs a guard:

1. Resolve User from session; **fail closed** if absent or deactivated.
2. Resolve Organization (tenant) from session.
3. Determine effective permissions from roles + scopes.
4. Check the permission; if absent → 403, no data returned.
5. Scope-check: if the grant is location-scoped, verify the target entity belongs to an allowed location **and** to the session tenant.
6. Only after all checks pass, invoke the service.

### What "never trust the client" means in practice
- Client may send `organization_id`, `role`, `member_id`, `payment status`, `attendance identity` — **all are ignored** or validated to match server state.
- Data lookups are always scoped by the tenant key resolved server-side; an out-of-tenant ID returns 403/404 (indistinguishable to avoid enumeration), never data.

## 5. Tenant boundary

An authenticated user belongs to exactly one organization. All their permitted data is within that organization. Multi-location is handled by per-location scopes — but always inside the same tenant. There is **no** cross-tenant user or cross-tenant data path.

## 6. Important edge cases

- **Deactivated user** holding an active session: every request re-checks status; immediately unauthorized.
- **Role changed** mid-session: permissions re-evaluated per request (no stale cached policy beyond the request).
- **Location reassignment**: a location-scoped role only affects data at the assigned location; reassigning a user's role never leaks another location's data.
- **Owner must not be deactivated** if they are the sole org owner (guard).
- **Lead reassignment / ownership** changes are audited and permission-gated (`lead:assign`, `lead:reassign`).
- **Enumeration defense**: 403 vs 404 indistinguishable for out-of-tenant IDs.

## 7. Enforcement points inventory

| Surface | Guard |
|---------|-------|
| Server Action | Session → tenant → permission → scope |
| Route handler (API) | Same as Server Action |
| RSC page data load | Permission + tenant scope |
| Server-side background job | Authenticated as service context, restricted to job's tenant scope |
| Automation action | Runs with the rule owner's effective permissions captured at creation (or service context), never broader |

Automation and background jobs execute with a **service identity** scoped to the rule's organization; they cannot act on data outside that organization.
