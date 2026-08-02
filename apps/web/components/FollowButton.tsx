"use client";

import { followStatusSchema } from "@habeshalive/shared";
import { useState } from "react";
import { openAuthModal } from "@/lib/useAuthModal";
import styles from "./FollowButton.module.css";

export function FollowButton({
  creatorId,
  isAuthed,
  initialFollowing,
}: {
  creatorId: string;
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
      const res = await fetch(`/api/backend/follows/${creatorId}`, { method: "POST" });
      if (res.ok) {
        const data = followStatusSchema.parse(await res.json());
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
      {following ? "Following" : "Follow"}
    </button>
  );
}
