import { redirect } from "next/navigation"

import { getCurrentUser } from "@/lib/auth/auth"

export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (user) {
    redirect("/dashboard")
  }
  return children
}