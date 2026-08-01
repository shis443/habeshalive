"use client";

import { useEffect, useState } from "react";
import styles from "./PrivacyCenterControls.module.css";

// Same fetch/PATCH pair as TopNav's Labeled Content settings sub-panel —
// duplicated here (not extracted) because this is the only other place
// it's used, and the two components need to independently manage their
// own loading/saving state. This page's whole point is to give the
// toggle a real, linkable home instead of it being reachable only from
// inside the Settings dropdown.
export function PrivacyCenterControls({ isAuthed }: { isAuthed: boolean }) {
  const [sensitivePref, setSensitivePref] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAuthed) return;
    fetch("/api/backend/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setSensitivePref(Boolean(data.showSensitiveContent));
      })
      .catch(() => {});
  }, [isAuthed]);

  async function handleToggle() {
    if (sensitivePref === null) return;
    const next = !sensitivePref;
    setSaving(true);
    try {
      const res = await fetch("/api/backend/auth/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showSensitiveContent: next }),
      });
      if (res.ok) setSensitivePref(next);
    } finally {
      setSaving(false);
    }
  }

  if (!isAuthed) {
    return <p>Log in to manage your data controls.</p>;
  }

  return (
    <div className={styles.control}>
      <div>
        <p className={styles.controlLabel}>Show sensitive/mature content</p>
        <p className={styles.controlHint}>
          Off by default. Streams a creator marks sensitive/mature are left out of your browse
          and search results entirely until this is on.
        </p>
      </div>
      <button
        type="button"
        className={sensitivePref ? styles.toggleOn : styles.toggle}
        onClick={handleToggle}
        disabled={sensitivePref === null || saving}
        aria-pressed={sensitivePref === true}
      >
        {sensitivePref === null ? "…" : sensitivePref ? "On" : "Off"}
      </button>
    </div>
  );
}
