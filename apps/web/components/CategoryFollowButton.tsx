"use client";

import { followStatusSchema } from "@birq/shared";
import { useState } from "react";
import { openAuthModal } from "@/lib/useAuthModal";
import styles from "./FollowButton.module.css";

// Phase 3.4 — category following. Reuses FollowButton.module.css directly
// (identical visual shape, a toggle pill) rather than duplicating styles
// for what's otherwise the same component pattern with a different
// endpoint.
export function CategoryFollowButton({
  category,
  isAuthed,
  initialFollowing,
}: {
  category: string;
  isAuthed: boolean;
  initialFollowing: boolean;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (!isAuthed) {
      openAuthModal();
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/backend/follows/category/${encodeURIComponent(category)}`, { method: "POST" });
      if (res.ok) {
        // See FollowButton.tsx's own comment on why .data must be
        // unwrapped first — apps/api wraps every response as
        // { success, data, error }.
        const body = (await res.json()) as { data: unknown };
        const data = followStatusSchema.parse(body.data);
        setFollowing(data.following);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className={`${styles.button} ${following ? styles.buttonFollowing : ""}`}
      onClick={handleClick}
      disabled={loading}
    >
      {following ? "Following category" : "Follow category"}
    </button>
  );
}
