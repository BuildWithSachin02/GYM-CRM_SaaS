![Uploading diagram.png…]()
# 🏋️ Gym CRM

> **A production-grade, multi-tenant Gym Management & CRM platform built for modern fitness businesses.**

Gym CRM is a modern SaaS platform that brings **member management, memberships, billing, attendance, lead management, follow-ups, automation, and analytics** into a single, centralized dashboard.

The platform is designed with a **multi-tenant architecture**, allowing multiple gyms or fitness businesses to operate independently from a shared application while keeping their business data logically isolated.

---

## 🚀 Overview

Gym CRM helps gym owners and fitness businesses manage their complete customer lifecycle — from the first lead interaction to membership conversion, payment collection, attendance tracking, renewals, and retention.

### Key Goals

* Simplify daily gym operations
* Centralize member and customer information
* Improve lead-to-member conversion
* Automate follow-ups and notifications
* Track memberships, payments, and renewals
* Provide actionable business analytics
* Support multiple independent gym businesses from a single SaaS platform

---

## ✨ Core Features

### 🏢 Multi-Tenant Architecture

Built from the ground up as a multi-tenant SaaS application.

* Isolated tenant data context
* Tenant-scoped business entities
* Tenant-aware authorization
* Shared PostgreSQL schema
* Single application serving multiple gyms
* Designed for scalable SaaS deployment

---

### 🏬 Branches

A gym that runs more than one location manages it from `/dashboard/branches`, not
from a settings tab. The module is first-class: it has its own navigation entry,
its own route and its own dedicated permissions.

* Branch directory with a card per location
* Per-branch overview metrics: active members, expiring memberships, outstanding
  dues, today's check-ins, open leads and 30-day revenue
* "Requires attention" alerts (deactivated branch, expiring memberships, unpaid
  dues, no active members, leads waiting)
* Quick links from a branch straight into the modules that matter for it
  (members, memberships, payments, attendance, leads, appointments, tasks,
  reports), with the branch context re-validated server-side
* Create and edit branch details (name, phone, email, address)
* Deactivate instead of delete: a deactivated location keeps its history, stops
  accepting new work (including QR scans) and can be reactivated
* Per-branch staff access with a primary branch per staff member
* Dedicated permissions, independent of gym settings administration

Branch codes (`BR-0001`, …) are generated server-side, unique per organization
and permanent. An organization's **last active branch can never be
deactivated**, so a tenant can never lock itself out of its own data.

---

### 👥 Member Management

Manage the complete member lifecycle from one dashboard.

* Member profiles
* Contact information
* Emergency/contact details
* Membership status
* Join date and expiry date
* Member lifecycle tracking
* Search and filtering
* Member activity overview

---

### 💳 Memberships & Billing

Manage gym plans, memberships, renewals, and payments.

* Create and manage membership plans
* Assign plans to members
* Track active and expired memberships
* Membership renewal management
* Payment recording
* Payment history
* Outstanding payment tracking
* Revenue monitoring

---

### 📱 QR-Based Attendance

Provide members with fast and convenient daily check-ins.

* Generate unique QR codes for members
* QR-based check-in
* Daily attendance tracking
* Attendance history
* Member attendance records
* Quick check-in workflow

---

### 🎯 Lead Management & CRM

Convert prospects into paying members with a structured CRM workflow.

* Lead capture
* Lead profiles
* Lead status tracking
* Follow-up management
* Appointment scheduling
* Lead-to-member conversion
* Sales pipeline tracking
* Follow-up reminders

---

### 🤖 Automation & Notifications

Reduce repetitive administrative work through automated workflows.

* Event-driven follow-ups
* Membership expiry alerts
* Payment reminders
* Lead follow-up notifications
* Renewal reminders
* System notifications
* Automated customer communication

---

### 📊 Reports & Analytics

Understand gym performance through actionable dashboards.

* Revenue analytics
* Membership trends
* Member growth
* Lead conversion metrics
* Retention insights
* Attendance analytics
* Membership expiry reports
* Business performance overview

---

## 🏗️ Architecture

Gym CRM follows a **server-first Next.js architecture** with a centralized database layer.

```text
┌───────────────────────────────────────────────┐
│                  Client / User                │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│              Next.js App Router              │
│                                               │
│  React Server Components + Client Components │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│              Application / API Layer         │
│                                               │
│  Authentication • Authorization • Validation │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│                  Prisma ORM                  │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│                 PostgreSQL                   │
│                                               │
│   Tenant → Members → Memberships → Payments │
│   Leads → Attendance → Notifications         │
└───────────────────────────────────────────────┘
```

### Tenant Isolation

Every business entity is associated with a tenant.

Conceptually:

```text
Tenant
 ├── Members
 ├── Memberships
 ├── Payments
 ├── Attendance
 ├── Leads
 ├── Appointments
 └── Notifications
```

All business queries should be scoped to the **currently authenticated tenant**, preventing data from one gym from being exposed to another.

---

## 🛠️ Tech Stack

| Layer                        | Technology              |
| ---------------------------- | ----------------------- |
| **Framework**                | Next.js 16 — App Router |
| **Language**                 | TypeScript              |
| **Frontend**                 | React 19                |
| **UI Components**            | shadcn/ui               |
| **UI Primitives**            | Base UI                 |
| **Icons**                    | lucide-react            |
| **Styling**                  | Tailwind CSS v4         |
| **CSS Integration**          | `@tailwindcss/postcss`  |
| **Database**                 | PostgreSQL              |
| **ORM**                      | Prisma                  |
| **Forms**                    | React Hook Form         |
| **Validation**               | Zod                     |
| **Charts**                   | Recharts                |
| **Notifications**            | Sonner                  |
| **QR Generation**            | qrcode                  |
| **Date Utilities**           | date-fns                |
| **Authentication Utilities** | bcryptjs                |
| **Theme Management**         | Custom (SSR-injected provider) |

---

## 📋 Prerequisites

Before running the project locally, make sure you have:

* **Node.js 20+**
* **npm**
* **PostgreSQL**
* A PostgreSQL database instance
* A configured `DATABASE_URL`

> **Package manager:** This project uses **npm**. Do not mix npm with pnpm, Yarn, or Bun.

---

## ⚙️ Getting Started

### 1. Clone the Repository

```bash
git clone <repository-url>

cd gym-crm
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the project root:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"

# Secret used to sign session cookies
AUTH_SECRET="replace-with-a-long-random-string"

# Password used for seeded demo accounts (prisma db seed). Min 8 characters.
SEED_OWNER_PASSWORD="replace-with-a-demo-password"
```

Replace the placeholder values with your own credentials. See `.env.example` for the full list of variables.

### 4. Generate Prisma Client

```bash
npx prisma generate
```

### 5. Run Database Migrations

```bash
npx prisma migrate dev
```

### 6. Seed Development Data

Optional. Requires `SEED_OWNER_PASSWORD` (min 8 characters) to be set in `.env`:

```bash
npm run seed
```

The seed creates demo accounts whose login password is the value of `SEED_OWNER_PASSWORD`.

### 7. Start the Development Server

```bash
npm run dev
```

The application will be available at:

```text
http://localhost:3000
```

---

## 📁 Project Structure

```text
gym-crm/
│
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   ├── (dashboard)/
│   │   ├── api/
│   │   └── ...
│   │
│   ├── components/
│   │   └── ui/
│   │
│   └── lib/
│       └── utils.ts
│
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
│
├── public/
│
├── eslint.config.mjs
├── next.config.*
├── postcss.config.mjs
├── tsconfig.json
├── package.json
└── README.md
```

### Import Alias

The project uses the following TypeScript path alias:

```text
@/* → src/*
```

Example:

```typescript
import { cn } from "@/lib/utils";
```

---

## 📜 Available Scripts

| Command             | Description                                   |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Start the development server                  |
| `npm run build`     | Create a production build and run type checks |
| `npm run start`     | Start the production server                   |
| `npm run lint`      | Run ESLint                                    |
| `npm test`          | Run the test suite                            |
| `npm run seed`      | Seed the database with development data       |
| `npm run db:studio` | Open Prisma Studio                            |

---

## 🔍 Development & Engineering Standards

### Type Safety

The project uses TypeScript with strict type checking enabled.

```json
{
  "strict": true,
  "noEmit": true
}
```

Type safety should be maintained across:

* Components
* API/data access
* Forms
* Database operations
* Server actions
* Utility functions

---

### Database

Prisma is used as the application's database abstraction layer.

Typical development workflow:

```bash
npx prisma generate
npx prisma migrate dev
npm run seed
```

Use Prisma Studio when inspecting or debugging development data:

```bash
npm run db:studio
```

---

### Styling

The application uses **Tailwind CSS v4** with:

```text
@tailwindcss/postcss
```

There is no traditional `tailwind.config.*` file.

---

### ESLint

The project uses **ESLint 9** with the modern flat configuration approach:

```text
eslint.config.mjs
```

Run linting with:

```bash
npm run lint
```

---

## ✅ Verification Workflow

Before considering a change complete, run:

```bash
npm run lint
```

followed by:

```bash
npm run build
```

Recommended workflow:

```text
Code Changes
     ↓
npm run lint
     ↓
Fix Issues
     ↓
npm run build
     ↓
Verify Application
```

---

## 🔐 Security & Data Isolation

Because Gym CRM is a multi-tenant SaaS application, tenant isolation is a core architectural requirement.

### Data Isolation Principles

* Every business entity should belong to a tenant.
* Database queries must be scoped to the authenticated tenant.
* Authorization must be validated server-side.
* Client-side tenant identifiers should never be trusted as authorization boundaries.
* Sensitive operations should require appropriate authentication and authorization.
* Database credentials must never be exposed to the client.

### Important Rule

> **Never execute a tenant-owned database query without first establishing the authenticated tenant context.**

### Branch Scoping

Branches add a **second** isolation axis inside a tenant. The rule is the same:
a branch id from a cookie, query string or form field is a *preference*, never
proof of authority.

* `getBranchFilter()` resolves the viewer's read scope from the session:
  an **owner** reads the whole organization, everyone else reads their assigned
  branches (plus organization-wide records).
* `getBranchFilterForRequest()` handles an explicit `?branch=<id>` (used by the
  Branches module's quick links). The id is resolved against the organization's
  **active** branches and the viewer's own authority; anything unknown, foreign,
  inactive or unauthorized returns a 404 rather than falling back to a wider
  scope.
* Every branch-scoped server action re-checks the visible-branch set, so
  holding `branches:edit` does not let a restricted admin edit a location they
  are not assigned to.
* `exactBranchFilter()` exists for metrics that must be attributed to exactly
  one branch. It has **no** organization-wide arm, which is what stops a
  branch's card from absorbing org-wide or sibling-branch records.

Branch filter kinds (`src/lib/branch-scope.ts`):

| Kind      | Matches                                          | Used for                        |
| --------- | ------------------------------------------------ | ------------------------------- |
| `all`     | everything in the organization                   | owner-wide pages                 |
| `single`  | one branch **+ org-wide** records                | a branch context in a module     |
| `multi`   | a set of branches **+ org-wide** records         | multi-branch staff views         |
| `exact`   | one branch, **nothing else**                     | per-branch card metrics          |
| `none`    | nothing (fail-closed backstop)                   | viewers with no branch access    |

### Branch Permissions

Branch administration is **not** part of `settings:manage`:

| Permission             | Grants                                                     |
| ---------------------- | ---------------------------------------------------------- |
| `branches:view`        | See the branch directory and branch details                 |
| `branches:create`      | Add a branch                                                |
| `branches:edit`        | Rename a branch and edit its contact details                |
| `branches:deactivate`  | Deactivate and reactivate a location                        |
| `branches:manage`      | Grant and revoke which staff may operate in a location      |

Owners and admins hold all five; receptionists may view only; trainers have no
branch surface. A gym can therefore delegate running a location without handing
over gym settings or data export.

---

## 🗺️ Product Roadmap

### Phase 1 — Core Gym Management

* [x] Project foundation
* [ ] Member management
* [ ] Membership plans
* [ ] Membership assignment
* [ ] Manual payments
* [ ] Basic dashboard

### Phase 2 — Attendance

* [ ] Member QR generation
* [ ] QR check-in
* [ ] Attendance history
* [ ] Attendance analytics

### Phase 3 — CRM

* [ ] Lead management
* [ ] Lead pipeline
* [ ] Appointments
* [ ] Follow-up management
* [ ] Lead conversion

### Phase 4 — Automation

* [ ] Membership expiry reminders
* [ ] Payment reminders
* [ ] Automated lead follow-ups
* [ ] Notification center
* [ ] Event-driven workflows

### Phase 5 — Analytics

* [ ] Revenue dashboard
* [ ] Membership analytics
* [ ] Retention analytics
* [ ] Lead conversion reports
* [ ] Attendance reports
* [ ] Business performance dashboard

### Phase 6 — Integrations

* [ ] WhatsApp integration
* [ ] Instagram integration
* [ ] Facebook integration
* [ ] Automated communication
* [ ] External CRM integrations

---

## 🚀 Future SaaS Capabilities

The architecture is designed to support future SaaS capabilities such as:

* Subscription-based gym plans
* Organization-level administration
* Role-based access control
* Staff management
* Custom branding
* Automated billing
* Payment gateway integration
* WhatsApp automation
* Advanced reporting
* Exportable reports
* Audit logs
* API access
* Webhooks

---

## 📈 Scalability Considerations

The application is designed around a shared-schema multi-tenant model, which allows the platform to serve multiple gyms without maintaining separate application instances.

As the platform grows, additional infrastructure can be introduced for:

* Background job processing
* Event queues
* Caching
* Rate limiting
* Database read replicas
* Observability
* Centralized logging
* Distributed notifications
* File/object storage

The architecture should evolve based on actual workload rather than premature infrastructure complexity.

---

## 🤝 Contributing

This is currently a **private/internal project**.

For internal development:

1. Create a feature branch.
2. Implement the required changes.
3. Run linting.
4. Run the production build.
5. Verify database migrations.
6. Test the affected workflows.
7. Submit the changes for review.

Example:

```bash
git checkout -b feature/member-management

npm run lint
npm run build

git add .
git commit -m "feat: add member management"
git push origin feature/member-management
```

---

## 📄 License

**Private / Internal Project**

All rights reserved.

This repository and its source code are proprietary. Unauthorized copying, distribution, modification, or commercial use is prohibited without permission from the project owner.

---

## 💡 Project Vision

> **Build a complete operating system for modern gyms — combining gym management, CRM, automation, and analytics into one scalable SaaS platform.**

Gym CRM aims to move gym businesses away from disconnected spreadsheets, messaging apps, and manual processes toward a **centralized, automated, data-driven platform**.

---

### Built with ❤️ for modern fitness businesses.
