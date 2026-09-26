# Authorization — Gym Management + CRM SaaS

## 1. Authorization model

**Server-side RBAC with per-user overrides.** The client (browser) never decides who may act. Every read/write is re-authorized from the server's own view of the authenticated `User`, their single `role`, their explicit `UserPermission` overrides, and their `Organization` (tenant).

Three concepts combine:

1. **Identity** — the authenticated user derived from the session (`getCurrentUser`, see `SECURITY.md`).
2. **Tenancy** — the `Organization` resolved from the session, never from the client.
3. **Permission** — a granular activity key, e.g. `members:create`, `staff:manage` (full catalog in `src/lib/permissions.ts`).
4. **Branch scope** — *WHERE* within the organization a user may operate (the `UserBranch`/branch layer; see Branch scope below).

## 2. Role model

A **Role** is a named baseline permission set. Every user has exactly **one** role.

| Role | Baseline (typ.) | Notes |
|------|-----------------|-------|
| `OWNER` | Full catalog, unconditional | Never narrowable by overrides |
| `ADMIN` | All operational modules + `staff:manage`, `settings:manage` | Cannot create/promote OWNER |
| `RECEPTIONIST` | Front-desk modules | No plans/trainers/staff management |
| `TRAINER` | View-most modules | No member create/update, no payments |

Role defaults live in `ROLE_PERMISSIONS` in `src/lib/permissions.ts`. See `src/lib/user-access.ts` for the decision helpers.

## 3. Permission evaluation

Effective permission set per user, computed **server-side on every request** by `effectivePermissions(role, overrides)`:

```
OWNER role        → full catalog (overrides ignored)
otherwise         → role defaults, then each override row applied:
                     granted=true  adds the permission
                     granted=false removes it
```

Precedence: **OWNER full-access > explicit `UserPermission` row > role default.**

- `getCurrentUser` (src/lib/auth/auth.ts) queries the rows and stores the computed set on `SessionUser.permissions`.
- `can(user, p)` / `canAny` / `requirePermission` (src/lib/permissions.ts) use `user.permissions` when present; without one they fall back to the role default so isolated callers/tests keep working.
- An override row with an unknown permission string is ignored safely.
- `updateUserPermissions` writes a full matrix with role defaults as the diff baseline, so revoking a default-granted permission correctly writes a `granted:false` row (see `tests/users-access.test.ts`).

## 4. OWNER guarantees

- `OWNER` **always** has the full catalog — `OWNER_FULL_ACCESS`.
- Permission overrides can **never** narrow an owner (`effectivePermissions` ignores overrides for the OWNER role; the permission editor hides editing for owners).
- **Only an OWNER** may create or promote another user to OWNER (`ownerRoleChangeForbidden`). An ADMIN holding `staff:manage` still cannot.
- The **last active OWNER** can never be deactivated or demoted (`wouldRemoveLastOwner` guard in create/update/status actions).
- Nobody can deactivate their **own** account (`isSelf` guard).
- Deactivation is soft (status `DEACTIVATED`); there is no hard delete of users.

## 5. Tenant boundary (organization isolation)

- The tenant key is always `user.organizationId` resolved server-side from the session.
- All staff lookups go through `findStaffInOrg(staffId, organizationId)`; every query in `src/lib/actions/*` filters by `organizationId`.
- A user from Organization A **cannot** read, list, modify, or audit Organization B staff: out-of-org IDs resolve to "not found"/"not authorized" indistinguishable errors.
- `username` is unique **per organization** (`User_organizationId_username_key`) and is a display alias only — the **email remains the login identifier**.

## 5.5 Branch scope (WHERE — implemented)

Branch scope answers *"which branch data may this user see/write?"* It is **orthogonal to permissions** (WHAT) and **never invents branch-specific permission keys** like `branch1_members:create`. Roles (OWNER/ADMIN/RECEPTIONIST/TRAINER) stay organization-wide; only WHERE is scoped.

- `OWNER` holds **organization-wide** branch access by role — no `UserBranch` rows exist for owners, and no branch switcher is shown.
- Every other role is restricted to its assigned **ACTIVE** branches (`UserBranch` rows: `isPrimary` picks the deterministic fallback branch).
- A user with **zero** branch assignments is mode `none` (fail-closed): every branch-filtered query matches nothing, and branch-integrating pages call `requireBranchAccess()` (`src/lib/branches.ts`), which throws `ForbiddenError` for that mode; the sidebar renders with no counts.
- **Branch selection** is stored in the `gym_branch` cookie (HttpOnly), set only by the server action `setBranchContext` (validates the requested branch is assigned and ACTIVE; OWNER clears it to org-wide). On every request `getBranchAccess()` re-derives from the session + cookie: tampered/unassigned cookies are ignored; fallback = requested → primary → first assigned.
- **Filter semantics** (`src/lib/branch-scope.ts`): mode `all` = no branch clause (owner); `single`/`multi` = `OR [{branchId}, {branchId: null}]` — assigning a user to one branch still shows organization-wide records (members home-less, org-level rows); `exact` = `{ branchId }` alone, **no** organization-wide arm, for metrics that must be attributed to exactly one branch; `none` = never-match clause. `isRecordVisible({ branchId })` treats `null` as org-wide-visible and `undefined` (not assigned) as hidden.
- **Branch is NOT a tenant boundary.** Every branch query is still org-scoped *and* branch-filtered; there is no cross-org path.
- **Branch management is a first-class module with its own permission keys** (`branches:view`, `branches:create`, `branches:edit`, `branches:deactivate`, `branches:manage`), *not* a Settings tab gated by `settings:manage`. OWNER and ADMIN hold all five; RECEPTIONIST holds view only; TRAINER holds none. A tenant admin can therefore run a location without gaining gym-details or data-export authority. See `src/lib/permissions.ts` and `tests/branch-permissions.test.ts`.
- **Which branches may be seen/acted on** is separate from *whether one may manage branches at all*: `decideVisibleBranchSet()` and `canViewBranch()` (`src/lib/branch-rules.ts`) reduce to the viewer's assigned ACTIVE branches (owners: all org branches), and every branch-scoped server action re-checks that set through `mayActOnBranch()` (`src/lib/actions/branches.ts`). Holding `branches:edit` therefore never lets a restricted admin craft a request naming a branch they are not assigned to.
- **Explicit branch context**: the Branches module's quick links carry `?branch=<id>`, resolved server-side by `getBranchFilterForRequest()` (`src/lib/branches.ts`). No param behaves exactly like `getBranchFilter()`; a param is honored only for an ACTIVE branch of the viewer's own organization that the viewer may view, and otherwise returns **404** (fail-closed) — it never falls back to a wider scope and never redirects.
- Only the final ACTIVE branch cannot be deactivated; an INACTIVE branch blocks new operations, staff assignment, and QR issuance but keeps its history, and only an owner-level viewer can reactivate it (a restricted viewer's accessible set contains ACTIVE branches only).

## 6. Role/permission change rules

- Role changes re-derive default permissions; explicit override rows still apply on top of the new role's defaults.
- Only OWNER may set the OWNER role (create team member or edit existing).
- Changing ownership/status/username permissions bumps the target's `sessionVersion` (see SECURITY.md §Session revocation).

## 7. Enforcement points (implemented)

| Surface | Guard |
|---------|-------|
| Server Actions (mutations) | `requireUserOrThrow()` + `can(user, "<perm>")` → `{ success:false, error }`; branch writes also `resolveWriteBranch()` |
| RSC page data loads | `requireUser()` + `if (!can(user, "<view>")) notFound()` + `requireBranchAccess()` + `branchFilterWhere(getBranchFilter())` |
| Branch context switch | `setBranchContext` action (validates assigned ACTIVE branch, OWNER clears cookie) |
| API route (`/api/data/export`) | `requireUserOrThrow()` + `can(user, "settings:manage")`; export narrowed by `getBranchFilter()` |
| Query actions (users page) | `requireUserOrThrow()` + `can(user, "staff:manage")` |
| Sidebar nav | items filtered by `can(user, item.permission)`; counts from `getSidebarCounts(org, tz, branchFilter)` |

Permission gates on mutations: `members:create/update/archive`, `plans:manage`, `memberships:manage`, `payments:record`, `attendance:record` (manual + QR), `leads:create/update/manage/convert`, `trainers:manage`, `appointments:manage`, `tasks:manage`, `notifications:update`, `settings:manage`, `staff:manage`. Page view guards: every `/dashboard/*` module page (see `src/app/dashboard`).

## 8. Sensitive grants

`staff:manage` (Users & Access – Manage users) is market as **sensitive** in `PERMISSION_MATRIX`. The permission editor requires an explicit confirmation checkbox before it may be granted, and a newly-granted `staff:manage` immediately takes effect server-side for that user's next request.