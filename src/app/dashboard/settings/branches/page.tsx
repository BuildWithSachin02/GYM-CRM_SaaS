import { redirect } from "next/navigation"

/**
 * Branches used to live under Settings. It is now a first-class module at
 * /dashboard/branches (with its own `branches:*` permissions), so this old path
 * is kept only as a permanent redirect for bookmarks — there is no second
 * management UI and no second set of gates to keep in sync.
 */
export default function LegacySettingsBranchesRoute() {
  redirect("/dashboard/branches")
}
