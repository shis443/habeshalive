import { redirect } from "next/navigation";

// Account and Settings used to be two separate pages with an overlapping
// purpose (see git history) — merged into one tabbed /settings page
// (SettingsTabs.tsx). This redirect keeps old bookmarks/links to /account
// working rather than 404ing.
export default function AccountPageRedirect() {
  redirect("/settings?tab=profile");
}
