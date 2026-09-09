# AGENTS.md

Production-grade multi-tenant Gym Management + CRM SaaS (Next.js + TypeScript + PostgreSQL + Prisma). First demo tenant: King's Gym.

## Current state (important)
Next.js foundation + shadcn/ui are set up. Do NOT assume auth/db/CRM features exist:
- Prisma is installed as a devDependency but **not initialized**: no `@prisma/client`, no `schema.prisma`, no `.env`, no models. Do not assume a DB exists or that queries work.
- shadcn/ui **is configured** (new `base-nova` style): `components.json`, `src/lib/utils.ts` (`cn` re-exported from the `cn` package), `src/components/ui/button.tsx`. Add more components via `npx shadcn@latest add <name>`. Note the init added the `shadcn` runtime package and `@base-ui/react` primitives (Base UI, not Radix).
- No auth, no database models, no CRM features, no tests, no CI, no commits yet.
- Auth, DB models, and CRM features should be added in later steps, not this foundation.

## Stack & config quirks
- Next.js 16 App Router with `src/` directory; import alias `@/*` → `src/*`.
- Tailwind **v4** (not v3). Configured via `@tailwindcss/postcss` + `@import "tailwindcss"` in `src/app/globals.css`. There is **no `tailwind.config.*`** and no `postcss` plugins file legacy options — don't try to add a v3-style config.
- ESLint 9 flat config in `eslint.config.mjs` (`eslint-config-next` core-web-vitals + typescript).
- App uses Next typed routes (e.g. `LayoutProps<"/">` in `src/app/layout.tsx`).

## Commands
- `npm run dev` — dev server (http://localhost:3000)
- `npm run lint` — runs ESLint (script is just `eslint`, no path args)
- `npm run build` — production build; **this also runs TypeScript type checking** (there is no separate `typecheck` script). Use it to verify types.
- `npm run start` — serve the production build

Verification order when making changes: `npm run lint` then `npm run build` (build covers typecheck).
- Package manager is **npm** (lockfile: `package-lock.json`). Don't introduce pnpm/yarn/bun.

## Planned architecture (for context, not yet built)
Multi-tenant model across users/tenants (King's Gym as first demo tenant). Upcoming domains: members, memberships, manual payments, QR attendance, leads, appointments, follow-ups, automation, notifications, reports, WhatsApp/Instagram/Facebook integrations. DB is PostgreSQL via Prisma. Keep these in mind when designing schema/API shape later, but do not implement now.
