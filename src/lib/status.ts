import type {
  AppointmentStatus,
  LeadSource,
  LeadStage,
  MemberStatus,
  MembershipStatus,
  PaymentMethod,
  PaymentStatus,
  PlanInterval,
  TaskStatus,
  UserRole,
} from "@prisma/client"

export type BadgeTone =
  | "default"
  | "success"
  | "warning"
  | "destructive"
  | "info"
  | "muted"

// Tone → Tailwind classes (shadcn badge-compatible)
export const toneClasses: Record<BadgeTone, string> = {
  default: "bg-primary/10 text-primary hover:bg-primary/15 border-transparent",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-transparent",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-transparent",
  destructive:
    "bg-red-500/10 text-red-700 dark:text-red-400 border-transparent",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-transparent",
  muted: "bg-muted text-muted-foreground border-transparent",
}

export function toneOfStatus(entry: {
  tone: BadgeTone
  label: string
}): { tone: BadgeTone; label: string } {
  return entry
}

export const MEMBER_STATUS: Record<
  MemberStatus,
  { tone: BadgeTone; label: string }
> = {
  ACTIVE: { tone: "success", label: "Active" },
  INACTIVE: { tone: "muted", label: "Inactive" },
  ARCHIVED: { tone: "destructive", label: "Archived" },
}

export const MEMBERSHIP_STATUS: Record<
  MembershipStatus,
  { tone: BadgeTone; label: string }
> = {
  ACTIVE: { tone: "success", label: "Active" },
  EXPIRED: { tone: "destructive", label: "Expired" },
  CANCELLED: { tone: "muted", label: "Cancelled" },
  PAUSED: { tone: "warning", label: "Paused" },
}

export const PAYMENT_STATUS: Record<
  PaymentStatus,
  { tone: BadgeTone; label: string }
> = {
  RECORDED: { tone: "success", label: "Recorded" },
  REFUNDED: { tone: "info", label: "Refunded" },
  VOIDED: { tone: "muted", label: "Voided" },
}

export const PAYMENT_METHOD: Record<PaymentMethod, { tone: BadgeTone; label: string }> = {
  CASH: { tone: "muted", label: "Cash" },
  UPI: { tone: "info", label: "UPI" },
  CARD: { tone: "default", label: "Card" },
  BANK_TRANSFER: { tone: "muted", label: "Bank Transfer" },
}

export const LEAD_STAGE: Record<LeadStage, { tone: BadgeTone; label: string }> = {
  NEW: { tone: "info", label: "New" },
  CONTACTED: { tone: "default", label: "Contacted" },
  VISIT_SCHEDULED: { tone: "warning", label: "Visit Scheduled" },
  VISIT_DONE: { tone: "info", label: "Visit Done" },
  CONVERTED: { tone: "success", label: "Converted" },
  LOST: { tone: "muted", label: "Lost" },
}

export const LEAD_SOURCE: Record<LeadSource, { tone: BadgeTone; label: string }> = {
  WEBSITE: { tone: "info", label: "Website" },
  INSTAGRAM: { tone: "default", label: "Instagram" },
  FACEBOOK: { tone: "info", label: "Facebook" },
  WHATSAPP: { tone: "success", label: "WhatsApp" },
  GOOGLE: { tone: "warning", label: "Google" },
  WALK_IN: { tone: "default", label: "Walk-in" },
  MANUAL: { tone: "muted", label: "Manual" },
}

export const APPOINTMENT_STATUS: Record<
  AppointmentStatus,
  { tone: BadgeTone; label: string }
> = {
  SCHEDULED: { tone: "info", label: "Scheduled" },
  COMPLETED: { tone: "success", label: "Completed" },
  CANCELLED: { tone: "muted", label: "Cancelled" },
  NO_SHOW: { tone: "destructive", label: "No-show" },
}

export const TASK_STATUS: Record<TaskStatus, { tone: BadgeTone; label: string }> = {
  TODO: { tone: "info", label: "To do" },
  IN_PROGRESS: { tone: "warning", label: "In progress" },
  COMPLETED: { tone: "success", label: "Completed" },
}

export const USER_ROLE: Record<UserRole, { tone: BadgeTone; label: string }> = {
  OWNER: { tone: "default", label: "Owner" },
  ADMIN: { tone: "info", label: "Admin" },
  RECEPTIONIST: { tone: "success", label: "Receptionist" },
  TRAINER: { tone: "warning", label: "Trainer" },
}

export const PLAN_INTERVAL: Record<
  PlanInterval,
  { tone: BadgeTone; label: string; days: number }
> = {
  MONTHLY: { tone: "info", label: "Monthly", days: 30 },
  QUARTERLY: { tone: "default", label: "Quarterly", days: 90 },
  HALF_YEARLY: { tone: "warning", label: "Half-Yearly", days: 180 },
  YEARLY: { tone: "success", label: "Yearly", days: 365 },
}