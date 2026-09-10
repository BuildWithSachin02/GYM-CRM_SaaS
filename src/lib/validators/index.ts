import { z } from "zod"

const requiredText = (min = 1, max = 200) =>
  z.string().trim().min(min, "Required").max(max, `Max ${max} characters`)

const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `Max ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))

const optionalPhone = () =>
  z
    .string()
    .trim()
    .regex(/^[+0-9 ()-]{7,20}$/, "Enter a valid phone number")
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))

const phone = () =>
  z.string().trim().regex(/^[+0-9 ()-]{7,20}$/, "Enter a valid phone number")

const optionalEmail = () =>
  z
    .string()
    .trim()
    .email("Enter a valid email")
    .optional()
    .nullable()
    .transform((v) => (v?.toLowerCase() ? v.toLowerCase() : null))

const email = () => z.string().trim().email("Enter a valid email").toLowerCase()

// Date fields travel over the wire as strings ("YYYY-MM-DD" for dates,
// "YYYY-MM-DDTHH:mm" for datetimes). Accept a Date too so callers have a
// single, forgiving contract, then normalize to a real Date for the DB.
const nullableDate = () =>
  z
    .union([z.string(), z.date()])
    .optional()
    .nullable()
    .transform((v) => (v ? new Date(v) : null))

const requiredDate = () =>
  z
    .union([z.string().min(1, "Required"), z.date()])
    .transform((v) => new Date(v))

const requiredDateTime = () =>
  z
    .union([z.string().min(1, "Required"), z.date()])
    .transform((v) => new Date(v))

// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: email(),
  password: z.string().min(1, "Password is required"),
})

export type LoginInput = z.infer<typeof loginSchema>

// ---------------------------------------------------------------------------

export const memberSchema = z.object({
  firstName: requiredText(1, 80),
  lastName: requiredText(1, 80),
  phone: phone(),
  email: z.union([optionalEmail(), z.literal("")]),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().nullable(),
  dateOfBirth: nullableDate(),
  address: optionalText(300),
  emergencyContactName: optionalText(80),
  emergencyContactPhone: optionalPhone(),
  trainerId: z.string().uuid().optional().nullable(),
  signupSource: z.enum(["WEBSITE", "INSTAGRAM", "FACEBOOK", "WHATSAPP", "GOOGLE", "WALK_IN", "MANUAL"] as const).optional().nullable(),
  notes: optionalText(1000),
})

export type MemberInput = z.input<typeof memberSchema>

// ---------------------------------------------------------------------------

export const planSchema = z.object({
  name: requiredText(1, 80),
  billingInterval: z.enum(["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"] as const),
  priceMinor: z.number().int().positive("Price must be positive").max(100_000_000),
  currency: z.string().trim().length(3).default("INR"),
  durationDays: z.number().int().positive("Duration must be positive").max(3650),
  description: optionalText(500),
  active: z.boolean().default(true),
})

export type PlanInput = z.infer<typeof planSchema>

// Form sends price in rupees; convert to minor units in the action.
export const planFormSchema = planSchema.extend({
  priceMinor: z.number().int().positive("Price must be positive").max(1_000_000),
})

// ---------------------------------------------------------------------------

export const membershipCreateSchema = z.object({
  memberId: z.string().uuid("Invalid member"),
  planId: z.string().uuid("Invalid plan"),
  startDate: requiredDate(),
  durationDays: z.number().int().positive(),
  amountMinor: z.number().int().positive("Amount must be positive"),
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER"] as const),
  notes: optionalText(500),
})

export type MembershipCreateInput = z.input<typeof membershipCreateSchema>

export const membershipRenewSchema = z.object({
  membershipId: z.string().uuid("Invalid membership"),
  planId: z.string().uuid("Invalid plan"),
  startDate: requiredDate(),
  durationDays: z.number().int().positive(),
  amountMinor: z.number().int().positive("Amount must be positive"),
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER"] as const),
  notes: optionalText(500),
  expiryDate: z.string().optional().nullable(),
})

export type MembershipRenewInput = z.input<typeof membershipRenewSchema>

// ---------------------------------------------------------------------------

export const paymentSchema = z.object({
  memberId: z.string().uuid("Invalid member"),
  membershipId: z.string().uuid("Invalid membership").optional().nullable(),
  amountMinor: z.number().int().positive("Amount must be positive"),
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER"] as const),
  paymentDate: requiredDate(),
  reference: optionalText(120),
  notes: optionalText(500),
})

export type PaymentInput = z.input<typeof paymentSchema>

// ---------------------------------------------------------------------------

export const manualCheckinSchema = z.object({
  memberId: z.string().uuid("Invalid member"),
  locationId: z.string().uuid("Invalid location").optional().nullable(),
})

export type ManualCheckinInput = z.infer<typeof manualCheckinSchema>

// ---------------------------------------------------------------------------

export const leadSchema = z.object({
  name: requiredText(1, 120),
  phone: phone(),
  email: z.union([optionalEmail(), z.literal("")]),
  source: z.enum(["WEBSITE", "INSTAGRAM", "FACEBOOK", "WHATSAPP", "GOOGLE", "WALK_IN", "MANUAL"] as const),
  sourceDetail: optionalText(200),
  stage: z.enum(["NEW", "CONTACTED", "VISIT_SCHEDULED", "VISIT_DONE", "CONVERTED", "LOST"] as const),
  interestedPlanId: z.string().uuid().optional().nullable(),
  ownerUserId: z.string().uuid().optional().nullable(),
  followUpDate: nullableDate(),
  notes: optionalText(1000),
})

export type LeadInput = z.input<typeof leadSchema>

export const leadStageSchema = z.object({
  leadId: z.string().uuid("Invalid lead"),
  stage: z.enum(["NEW", "CONTACTED", "VISIT_SCHEDULED", "VISIT_DONE", "CONVERTED", "LOST"] as const),
})

export type LeadStageInput = z.infer<typeof leadStageSchema>

export const leadActivitySchema = z.object({
  leadId: z.string().uuid("Invalid lead"),
  type: z.enum(["CALL", "WHATSAPP", "MESSAGE", "VISIT", "NOTE", "FOLLOW_UP"] as const),
  body: requiredText(1, 500),
  activityDate: z.string().optional().transform((v) => (v ? new Date(v) : new Date())),
})

export type LeadActivityInput = z.infer<typeof leadActivitySchema>

export const leadConvertSchema = z.object({
  leadId: z.string().uuid("Invalid lead"),
  planId: z.string().uuid("Invalid plan"),
  startDate: requiredDateTime(),
  durationDays: z.number().int().positive(),
  amountMinor: z.number().int().positive("Amount must be positive"),
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER"] as const),
})

export type LeadConvertInput = z.infer<typeof leadConvertSchema>

// ---------------------------------------------------------------------------

export const appointmentSchema = z.object({
  memberId: z.string().uuid().optional().nullable(),
  leadId: z.string().uuid().optional().nullable(),
  trainerId: z.string().uuid().optional().nullable(),
  staffId: z.string().uuid().optional().nullable(),
  startsAt: requiredDateTime(),
  endsAt: requiredDateTime(),
  status: z.enum(["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const),
  notes: optionalText(500),
  locationId: z.string().uuid().optional().nullable(),
}).refine((v) => (v.memberId ?? null) !== null || (v.leadId ?? null) !== null, {
  message: "Appointment must be linked to a member or a lead",
}).refine((v) => v.endsAt > v.startsAt, {
  message: "End time must be after start time",
})

export type AppointmentInput = z.input<typeof appointmentSchema>

export const appointmentStatusSchema = z.object({
  appointmentId: z.string().uuid("Invalid appointment"),
  status: z.enum(["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const),
})

export type AppointmentStatusInput = z.infer<typeof appointmentStatusSchema>

// ---------------------------------------------------------------------------

export const taskSchema = z.object({
  title: requiredText(1, 200),
  description: optionalText(1000),
  dueDate: requiredDate(),
  status: z.enum(["TODO", "IN_PROGRESS", "COMPLETED"] as const),
  assigneeId: z.string().uuid().optional().nullable(),
  memberId: z.string().uuid().optional().nullable(),
  leadId: z.string().uuid().optional().nullable(),
})

export type TaskInput = z.input<typeof taskSchema>

export const taskStatusSchema = z.object({
  taskId: z.string().uuid("Invalid task"),
  status: z.enum(["TODO", "IN_PROGRESS", "COMPLETED"] as const),
})

export type TaskStatusInput = z.infer<typeof taskStatusSchema>

// ---------------------------------------------------------------------------

export const staffSchema = z.object({
  name: requiredText(1, 120),
  email: email(),
  phone: optionalPhone(),
  role: z.enum(["OWNER", "ADMIN", "RECEPTIONIST", "TRAINER"] as const),
  password: z.string().min(8, "Password must be at least 8 characters"),
})

export type StaffInput = z.infer<typeof staffSchema>

export const staffUpdateSchema = z.object({
  staffId: z.string().uuid("Invalid staff"),
  name: requiredText(1, 120),
  phone: optionalPhone(),
  role: z.enum(["OWNER", "ADMIN", "RECEPTIONIST", "TRAINER"] as const),
  status: z.enum(["ACTIVE", "DEACTIVATED"] as const),
  password: z.string().optional().nullable().refine((v) => !v || v.length >= 8, {
    message: "Password must be at least 8 characters",
  }),
})

export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>

// ---------------------------------------------------------------------------

export const trainerSchema = z.object({
  userId: z.string().uuid("Invalid staff member"),
  bio: optionalText(500),
  specialties: z.array(z.string().trim().max(40)).max(10).optional().nullable(),
  active: z.boolean().default(true),
})

export type TrainerInput = z.infer<typeof trainerSchema>

// ---------------------------------------------------------------------------

export const orgSettingsSchema = z.object({
  name: requiredText(1, 120),
  phone: optionalPhone(),
  email: optionalEmail(),
  address: optionalText(300),
  city: optionalText(80),
  state: optionalText(80),
  country: optionalText(80),
  timezone: z.string().trim().min(1).max(60),
})

export type OrgSettingsInput = z.infer<typeof orgSettingsSchema>

// ---------------------------------------------------------------------------

export const qrSessionSchema = z.object({
  locationId: z.string().uuid("Invalid location"),
  label: optionalText(120),
  expiresInMinutes: z.number().int().min(1).max(1440).default(60),
})

export type QrSessionInput = z.infer<typeof qrSessionSchema>

// ---------------------------------------------------------------------------

export const enumOptions = {
  leadStage: ["NEW", "CONTACTED", "VISIT_SCHEDULED", "VISIT_DONE", "CONVERTED", "LOST"],
  leadSource: ["WEBSITE", "INSTAGRAM", "FACEBOOK", "WHATSAPP", "GOOGLE", "WALK_IN", "MANUAL"],
  leadActivityType: ["CALL", "WHATSAPP", "MESSAGE", "VISIT", "NOTE", "FOLLOW_UP"],
  paymentMethod: ["CASH", "UPI", "CARD", "BANK_TRANSFER"],
  planInterval: ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"],
  userRole: ["OWNER", "ADMIN", "RECEPTIONIST", "TRAINER"],
  appointmentStatus: ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"],
  taskStatus: ["TODO", "IN_PROGRESS", "COMPLETED"],
} as const