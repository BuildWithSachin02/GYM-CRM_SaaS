# UI/UX System — Gym Management + CRM SaaS

## 1. Foundations

Built on the existing stack: **Next.js 16 App Router + React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui** (`base-nova` style, Base UI primitives). Reusable, accessible primitives are added via `npx shadcn@latest add <name>`; custom components are composed from those.

- Import alias `@/*` → `src/*`; UI components in `src/components/ui`, feature components in `src/components`.
- `src/lib/utils.ts` exports `cn` for class merging.
- Tailwind v4: theming via CSS variables in `src/app/globals.css` (no `tailwind.config.*`).

## 2. Design tokens

- **Color**: semantic CSS variables (background, foreground, primary, secondary, muted, accent, destructive, card, popover, ring, sidebar, chart) with light and dark schemes. Use semantic tokens; do not hardcode palette hexes in components.
- **Typography**: `--font-sans` (Geist) and `--font-mono`; hierarchy via utility classes, no ad-hoc font sizes.
- **Radius**: `--radius` and derived `--radius-sm/md/lg/xl/2xl/3xl/4xl` tokens.
- **Spacing**: Tailwind default scale.
- **Animation**: `tw-animate-css` for transitions; respect `prefers-reduced-motion`.

## 3. Layout system

- **Authenticated shell** (future): left sidebar navigation + top bar + content area. Use shadcn `sidebar` components. Sidebar groups: Overview (dashboard), Members, Plans & Memberships, Payments, Attendance (QR), Leads (pipeline), Appointments, Automation, Notifications, Reports, Settings.
- **Navigation is one pure list** (`src/lib/nav-items.ts`): `NAV_ITEMS` fixes the canonical order, `visibleNavItems(can)` filters it by permission, and both the desktop sidebar and the mobile sheet render the same entries, so they cannot drift. Canonical order: Dashboard, **Branches**, Members, Memberships, Plans, Payments, Attendance, QR Check-in, Leads, Trainers, Appointments, Tasks, Reports, Users & Access, Settings (always last). The order and the Branches placement are asserted in `tests/nav-items.test.ts`. Topbar titles come from the same module (`navTitleForPath`).
- **Branches page** (`/dashboard/branches`): a responsive card grid (1 / 2 / 3 columns), each card showing the branch name, code, status, location, up to two "requires attention" items, six metrics, and its permitted actions. Desktop and mobile use the same card component; the grid collapses to a single column on small screens. Branch details live at `/dashboard/branches/[id]` and reuse the same card model so a figure can never mean two different things between the two views.
- **Landing/auth layout**: centered card, minimal chrome. Auth is not implemented yet.
- Every route is a Server Component by default; interactive islands use Client Components.

## 4. Component conventions

- Prefer shadcn/ui base components (button, input, card, table, dialog, select, form, toast, etc.) over hand-rolled equivalents.
- Extend via `cva` where variants are needed; keep component APIs typed.
- Use lucide-react for icons (`iconLibrary: "lucide"`).
- Data-dense tables with server-side pagination/sorting for large lists (members, payments, leads, attendance).
- Loading states: skeleton components; error states: inline `Alert` + retry.
- Empty states: descriptive helper text with a primary call-to-action.

## 5. Page patterns

| Module | Primary view | Key interactions |
|--------|-------------|------------------|
| Members | Table + member detail | Create/edit, freeze, view memberships, history |
| Plans | Card/table list | Create/archive plan |
| Memberships | Member-centric list | Start, renew, freeze, cancel |
| Payments | List + record form | Record manual payment, refund, void |
| Attendance | QR scanner/check-in UI + log | Scan QR session, view check-ins |
| Leads | Kanban/table pipeline | Create, assign, stage change, activity, follow-up |
| Appointments | Calendar/list | Schedule, complete, cancel |
| Automation | Rules list + rule builder | Create/edit TRIGGER→CONDITIONS→ACTIONS |
| Notifications | Inbox list | Mark read, view delivery status |
| Reports | Period selector + charts | Aggregate views |
| Branches | Card grid + branch detail | Add/edit branch, view metrics, manage branch staff, deactivate/reactivate |
| Settings | Organization, users, roles | Manage users/roles, gym details, data management |

Branches is a **top-level module**, not a Settings tab: `/dashboard/settings/branches` only redirects to `/dashboard/branches` for old bookmarks, so there is exactly one management UI and one permission set (`branches:*`). Deactivation is presented instead of deletion, and the final active branch cannot be deactivated.

## 6. Accessibility (a11y)

- Use semantic HTML and ARIA from Base UI/shadcn primitives.
- Keyboard navigation for all interactive controls (menus, dialogs, tables, kanban).
- Focus management and focus-visible indicators.
- Color-contrast aware tokens; don't rely on color alone.
- Form errors announced and associated with inputs (aria-describedby).
- Respect `prefers-reduced-motion`.

## 7. Forms and validation

- Client-side validation for immediate feedback; **server-side validation is authoritative**.
- Reusable form field components consistent with shadcn `form` pattern.
- Money fields: integer minor units stored, currency-formatted display.
- Date/time: always store UTC, render in the organization's timezone (Branches inherit it; there is no per-branch timezone).

## 8. Responsive behavior

- Desktop-first for operational dashboards; usable on tablet.
- Kanban/sidebar collapse to sensible mobile layouts; tables become scrollable or card lists.
- QR scanner works on mobile browsers of staff phones.

## 9. Empty/loading/error states

Consistent across the app:
- **Loading**: skeleton placeholders at the expected content shape.
- **Error**: message + retry, no stack traces shown to end users.
- **Empty**: what's here, why it's empty, and an action to fill it.

## 10. Multi-tenant consideration

The UI always operates within a resolved organization AND branch context. The tenant/org is not a user input; it comes from the session. **Branch scope** is resolved server-side from the session + branch-preference cookie: an OWNER sees everything (no switcher); a user assigned to exactly one branch sees a static branch badge and no switcher; a user with several branches gets a branch switcher in the topbar/header (server-validated, refreshes the view). A user with zero assignments is fail-closed — no branch views. Nothing in the UI hardcodes King's Gym; the demo tenant name is metadata, not UI logic.
