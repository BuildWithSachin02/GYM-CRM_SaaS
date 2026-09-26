# Testing Strategy — Gym Management + CRM SaaS

## 1. Guiding principles

- **Test behavior, not implementation.** Prefer behavior-driven cases for business rules.
- **Server-first.** Most critical tests target server services, authorization, and tenant isolation — not the UI.
- **All verifications run in CI eventually.** Local verification uses `npm run lint` and `npm run build` (build also type-checks; there is no separate `typecheck` script).
- No test framework is installed yet; this document specifies the planned approach.
- **Current state:** a pure-Node unit suite already runs via `npx tsx --test "tests/*.test.ts"` (no framework, no DB required) — branch decision rules, member-attendance math, QR decisions, automation scheduling, validators, workbook/export mapping. `npm run lint` and `npm run build` (build also type-checks) are the pre-merge guards; there is no `typecheck` script.
- Scope: unit, integration, security, e2e, and automation-engine tests. All integration/DB tests run against the same Prisma/Postgres model.

## 2. Pyramid

1. **Unit tests** — fast, for pure domain logic (business rules, validation, stage transitions, token generation).
2. **Integration tests** — server services + Prisma against a test Postgres database (isolated schemas per test run).
3. **Security tests** — authorization, tenancy, QR, payment tampering, webhook signature.
4. **E2E (UI)** — a thin layer over the highest-value happy paths (member check-in, lead conversion).

## 3. Test categories and coverage

### 3.1 Business rule tests
- Membership lifecycle transitions (draft→active→frozen→…), expiry + grace period, freeze math.
- Payment: record/refund/void; balance recomputation; reject payment on cancelled membership (EC-07).
- Lead stage transitions incl. terminal states and reopen (EC-05).
- Duplicate detection (leads, attendance scans EC-03, automation dedupe).

### 3.2 Authorization & tenancy tests
- Unauthenticated request → denied (fail closed).
- Role lacking permission → 403, no data returned.
- Branch-restricted user cannot read another branch's rows (org-wide records with null branch remain visible; assigned-branch rows only).
- Branch access modes: OWNER `all` (no UserBranch rows needed), single assignment (single fallback), multi (switcher + primary fallback), zero assignments (fail-closed, nothing matches).
- Forging `organization_id` in a request is ignored; server resolves tenant from session.
- Forged/tampered `gym_branch` cookie is ignored; fallback = requested → primary → first assigned.
- Out-of-tenant `member_id`, `lead_id`, `payment_id` → indistinguishable 403/404.
- Deactivated user / revoked session denied on every request.

### 3.3 QR attendance security tests
- Static QR never carries a member ID (assert token is opaque/high-entropy).
- Token stored only as hash; raw token never persisted.
- Expired token rejected; revoked token rejected; wrong-branch rejected.
- Inactive branch rejects session creation and scans (`branch_inactive`).
- Duplicate scan within window rejected (single check-in).
- Check-in requires active membership; frozen/member-without-membership rejected.

### 3.4 Payments security tests
- Client-submitted amount/status is overridden/validated server-side.
- Refund/void require the matching permission.
- Payment mutations write audit entries; money stored as integer minor units.
- Idempotency: duplicate payment intent does not create duplicate records.

### 3.5 Automation engine tests
- TRIGGER→CONDITIONS→ACTIONS evaluation matches expectation.
- Idempotency: retry of the same (rule, entity) does not duplicate actions.
- Retries and dead-letter behavior for persistent failures.
- Rule disabled ⇒ no new jobs; tenant isolation of the dispatcher.
- Condition referencing deleted entity → no-op (EC-06).

### 3.6 Integration/webhook tests (future)
- Webhook signature verification; unsigned/mismatched → 401.
- Credential encryption at rest and rotation/revocation.
- Provider adapter mocked; retry and idempotency verified on failure.

### 3.7 E2E happy paths
- Staff records a manual payment and sees updated balance.
- Member scans QR → successful check-in; duplicate scan rejected.
- Staff creates a lead, schedules a follow-up, converts to a member.
- Automation rule fires and creates the expected notification/follow-up.

## 4. Fixtures and DB handling

- Test database created per run; Prisma migrations applied; data cleared between tests.
- Tenant fixtures: at least two distinct organizations so cross-tenant isolation is actually asserted.
- Factories for members/plans/leads/payments with tenant-keyed creation.

## 5. Testing tools (planned)

- Unit/assertion + mocking: consistent with the Next.js/TS ecosystem (e.g. Vitest + a mocking lib).
- Integration: test against the same Prisma client and Postgres used in production.
- E2E: Playwright.
- linter/typecheck guardrails (`npm run lint`, `npm run build`) run before every PR.

## 6. Flaky/expensive suites

- Mark QR-token and automation scheduling tests as time-sensitive; use injectable clocks to avoid flakiness.
- Keep the automation worker testable by abstracting the job runner.
- E2E suite is kept small and tagged to run in CI separately from unit/integration.

## 7. CI expectations (future)

- Every PR: lint → build → unit → integration → security → e2e (small subset).
- Secrets for test webhook/mocks are never real credentials.
- Migration safety: any schema change includes a review of tenant-keyed indexes (see `DATABASE_DESIGN.md` §6–7).
