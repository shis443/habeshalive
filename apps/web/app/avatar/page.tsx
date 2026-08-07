import { redirect } from "next/navigation";
import { AvatarEditor } from "@/components/AvatarEditor";
import { BottomNav } from "@/components/BottomNav";
import { getAvatarParts, getAvatarSelection, getCurrentUser } from "@/lib/api";

export default async function AvatarPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/avatar");

  const [manifest, selection] = await Promise.all([getAvatarParts(), getAvatarSelection()]);

  return (
    <>
      <AvatarEditor manifest={manifest} initialSelection={selection ?? {}} initialAvatarUrl={user.avatarUrl} />
      <BottomNav />
    </>
  );
}
