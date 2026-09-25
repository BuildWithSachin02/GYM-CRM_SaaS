"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { prisma } from "@/lib/prisma"
import { verifyPassword } from "@/lib/auth/password"
import { SESSION_COOKIE, createSessionToken } from "@/lib/auth/session"
import { loginSchema } from "@/lib/validators"
import { writeAudit } from "@/lib/audit"

export async function loginAction(input: { email: string; password: string }) {
  const parsed = loginSchema.safeParse(input)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? "Invalid input"
    return { error: firstError }
  }

  const { email, password } = parsed.data

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      status: true,
      organizationId: true,
      sessionVersion: true,
    },
  })

  if (!user) {
    return { error: "Invalid email or password" }
  }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    return { error: "Invalid email or password" }
  }

  if (user.status !== "ACTIVE") {
    return { error: "This account has been deactivated. Contact your administrator." }
  }

  const token = await createSessionToken(user.id, user.sessionVersion)
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: "auth.login",
    entityType: "User",
    entityId: user.id,
  })

  redirect("/dashboard")
}

export async function logoutAction() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
  redirect("/login")
}