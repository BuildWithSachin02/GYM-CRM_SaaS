# Automation Engine — Gym Management + CRM SaaS

## 1. Model

An **AutomationRule** is organization-owned and expressed as:

```
TRIGGER  →  CONDITIONS  →  ACTIONS
```

- **TRIGGER** — the domain event (or time/schedule) that starts evaluation.
- **CONDITIONS** — zero or more predicates that must hold for the actions to run.
- **ACTIONS** — one or more typed effects executed in order.

Rules are stored as structured configuration (JSONB in the `AutomationRule` table; see `DATABASE_DESIGN.md` §4.18) and validated server-side.

## 2. Triggers

### Event triggers
| Trigger | Entity | Example |
|---------|--------|---------|
| `lead.created` | Lead | Lead first enters the system |
| `lead.stage_changed` | Lead | Fires on stage transition |
| `lead.assigned` | Lead | Ownership changed |
| `lead.not_contacted_after` | Lead | Time-based re-check |
| `member.created` | Member | New member |
| `membership.created` | Membership | Membership starts |
| `membership.expiring` | Membership | Emitted before expiry |
| `membership.frozen` / `membership.cancelled` | Membership | Lifecycle changes |
| `payment.recorded` | Payment | Manual payment recorded |
| `appointment.scheduled` | Appointment | Appointment created |
| `followup.due` | FollowUp | Follow-up reached due time |

### Scheduling
Time-based triggers (e.g. `lead.not_contacted_after`) are evaluated by a scheduled worker, not by a single event. They are still expressed as rules with a computed condition.

## 3. Conditions

Conditions are predicates over the trigger payload plus the current entity state. Examples:

- Stage is `contacted` and `last_activity` older than 24h.
- Membership ends within 7 days and has not been renewed.
- Payment method is `cash` and status is `recorded`.
- Lead source is `whatsapp`.

Conditions are evaluated against the tenant-scoped entity state; a condition referencing a deleted entity evaluates to `false` (no crash), per EC-06.

## 4. Actions

Typed effects, each idempotent:

| Action | Effect |
|--------|--------|
| `create_activity` | Add a LeadActivity (e.g. a note) |
| `send_notification` | Create a Notification (inbox first; channels extensible) |
| `create_followup` | Schedule a FollowUp with due time + assignee |
| `update_field` | Update a permitted field on the entity (limited whitelist) |
| `webhook` (future) | Call an external endpoint (see integrations) |

## 5. Execution semantics

1. A domain event is recorded to an **outbox** (event log) as part of the same transaction that produced it.
2. A dispatcher reads the outbox (per tenant), finds enabled rules whose trigger matches, and enqueues an evaluation job.
3. Job evaluation:
   - Re-load the entity under the rule's tenant scope.
   - Evaluate conditions.
   - If all pass, run actions.
4. **Idempotency**: each (rule, entity_ref) execution is keyed by a `dedupe_key`. A unique constraint prevents duplicate application even on retry.
5. **Retries**: transient failures (external timeout, deadlock) retry with backoff. Persistent failures move the job to `dead` status for review (dead-letter).
6. **Ordering**: within one rule, actions run sequentially; a failing action is retried, not skipped.

## 6. Concurrency and isolation

- Automation reads/writes strictly within the rule's organization (service identity).
- Money-adjacent actions (e.g. creating a follow-up or notification) are transactional and idempotent; automation never bypasses payment or membership business rules.
- A rule does not inherit user permissions; it runs with the organization-scoped service context (see `AUTHORIZATION.md` §7).

## 7. Rule lifecycle

- Enabled/paused toggle; paused rules are not evaluated.
- Failed/`error` status surfaces for review.
- Rules are versioned config; disabling takes effect immediately; edits to an enabled rule restart evaluation against the new config.

## 8. Reliability

- **Outbox pattern** ensures no lost events between transaction and dispatch.
- Worker processes jobs with lease/locking to prevent duplicate concurrent execution.
- Dead-letter review is surfaced in the UI (automation admin, `automation:manage`).

## 9. Data model recap

- `AutomationRule` (config) and `AutomationJob` (execution records with status/attempts/dedupe_key). See `DATABASE_DESIGN.md` §4.18–4.19.

## 10. Edge cases

- **Rule added after event already occurred**: only future events trigger; no retroactive replay unless explicitly designed as a scheduled check.
- **Entity deleted before evaluation**: condition → false, job no-ops.
- **Rule disabled mid-job**: in-flight job completes; no new jobs scheduled.
- **Duplicate rules**: no guard, but dedupe_key keeps effects idempotent.
- **Cross-tenant propagation**: dispatcher must never evaluate a rule against another tenant's data (tenant key enforced at every query).

## 11. Relationship to other docs

- Notifications: `PRODUCT_REQUIREMENTS.md` §5.13, `ARCHITECTURE.md` §7.
- Telephony/whatsapp delivery: `INTEGRATIONS.md`.
- Testing of the engine: `TESTING_STRATEGY.md`.
