# Leads & CRM — Gym Management + CRM SaaS

## 1. Purpose

A lead is a potential member. The CRM tracks where leads come from, their progress through a pipeline, the activities performed, follow-ups scheduled, and conversion into members. Everything is organization-owned and tenant-isolated.

## 2. Lead sources (attribution)

A fixed enum with optional detail for deeper attribution:

| Source | Meaning | Optional detail |
|--------|---------|-----------------|
| `website` | Contact/web form | UTM campaign, landing page, form |
| `instagram` | Instagram engagement | post/reel/profile link |
| `facebook` | Facebook engagement | ad/post/messenger |
| `whatsapp` | WhatsApp inquiry | phone/wa context |
| `google` | Google (Search/Ads/Maps) | campaign, keyword |
| `walk-in` | Walked into the gym | staff note |
| `manual` | Staff-entered | note |

`source` is required; `source_detail` optional. Attribution is immutable after creation (mutation requires audit + permission).

## 3. Lead lifecycle / pipeline

Stages: `new` → `contacted` → `visit-scheduled` → `visit-done` → `converted` | `lost` | `unqualified`.

### Allowed transitions (controlled server-side)
- `new` → `contacted`, `visit-scheduled`, `lost`, `unqualified`
- `contacted` → `visit-scheduled`, `visit-done`, `lost`, `unqualified`
- `visit-scheduled` → `visit-done`, `lost`, `unqualified`
- `visit-done` → `converted`, `lost`
- `converted`, `lost`, `unqualified` are terminal (no forward transitions; may be reopened only with `lead:reopen` and audit).

These are the default transitions; organizations may later customize the pipeline via configuration, but the base set is validated by default.

## 4. Key entities and relationships

- **Lead** — org-owned; belongs to a `branch` (nullable — org-level leads are visible to every branch scope) and an `owner_user` (current assignee).
- **LeadActivity** — a CRM touchpoint (note/call/message/visit/email) on a lead.
- **FollowUp** — a scheduled activity with a due time and assignee.
- **Appointment** — scheduled visit with a lead (or member); see below.

## 5. Core workflows

### 5.1 Lead creation
1. Input validated; `organization_id` and branch derived server-side (write branch resolved via `resolveWriteBranch`, validated against the user's assignment).
2. Source required; duplicate-detection by email/phone within the org flags potential dupes.
3. Lead starts at `new`, assigned to the default/available owner.

### 5.2 Follow-up scheduling
1. Staff (or automation) schedules a follow-up with `due_at` and assignee.
2. On due time, an automation trigger fires to notify the assignee (→ `AUTOMATION_ENGINE.md`).
3. Completing/dismissing the follow-up is logged as an activity.

### 5.3 Conversion
1. When a lead converts, the server creates a **Member** and links `lead.converted_member_id` (unique).
2. A membership can then be attached via normal plan/signup flow.
3. Conversion is guarded: a lead with an existing `converted_member_id` cannot be converted again (EC-05).
4. `converted_on` is recorded; the conversion is audited.

## 6. Ownership and reassignment

- A lead has exactly one current owner (BR-05).
- Reassignment requires `lead:reassign`, is recorded as an activity, and is audited.
- Leads assigned to a deactivated user are flagged for reassignment.

## 7. Appointments (CRM side)

An **Appointment** binds a lead or member to a staff user and a branch with a time range. Status: `scheduled`, `completed`, `cancelled`, `no-show`. Only staff with `appointment:*` permission for the governing branch can modify (branch resolved server-side). See `DATABASE_DESIGN.md` §4.17.

## 8. Automation hooks

Leads subscribe to automation triggers: `lead.created`, `lead.stage_changed`, `lead.assigned`, `followup.due`, `lead.not_contacted_after`. Refer to `AUTOMATION_ENGINE.md`.

## 9. Reports

Lead funnel metrics — lead count by source, conversion rate, stage distribution, time-in-stage, follow-up completion — are organization-scoped (`report:read`). See `PRODUCT_REQUIREMENTS.md` §5.14.

## 10. Edge cases

- **Duplicate lead** on same email/phone: warning, not hard block; merge is a future tool.
- **Conversion with no owner**: blocked or assigned to default owner first.
- **Reopening a lost/unqualified lead**: requires `lead:reopen`, moves to `contacted`, audited.
- **Source police**: manual edits to `source`/`source_detail` are restricted and audited.
- **Tenant isolation**: a lead can never be assigned or read across organizations.

## 11. Client trust

`owner_user_id`, `current_stage`, `source`, and `converted_member_id` are all server-validated. The client only submits intent (e.g. "convert this lead"); the server resolves ownership, stage legality, and conversion.
