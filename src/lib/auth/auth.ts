import "server-only"

import { cache } from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { prisma } from "@/lib/prisma"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session"

export type SessionUser = {
  id: string
  name: string
  email: string
  role: "OWNER" | "ADMIN" | "RECEPTIONIST" | "TRAINER"
  organizationId: string
  organization: { id: string; name: string; slug: string; currency: string; timezone: string }
}

/** Reads the current session and returns the authenticated user (or null). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  const userId = await verifySessionToken(token)
  if (!userId) return null

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      organizationId: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          currency: true,
          timezone: true,
          status: true,
        },
      },
    },
  })

  if (!user || user.status !== "ACTIVE" || user.organization.status !== "ACTIVE") {
    return null
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    organization: user.organization,
  }
})

/** Requires an authenticated, active user — otherwise redirects to login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) {
    redirect("/login")
  }
  return user
}

/** Requires the user to be logged in; throws otherwise (for actions/APIs). */
export async function requireUserOrThrow(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error("Unauthorized")
  }
  return user
}

/** Redirects authenticated users away from the login page. */
export async function optionalUser(): Promise<SessionUser | null> {
  return getCurrentUser()
}