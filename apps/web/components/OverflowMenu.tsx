"use client";

import { useState } from "react";
import { useDropdown } from "@/lib/useDropdown";
import { openAuthModal } from "@/lib/useAuthModal";
import { ReportModal } from "./ReportModal";
import styles from "./ShareSheet.module.css";
import { MoreIcon } from "./icons";

// D.1's three-dot overflow menu / D.4's report entry points. Reuses
// ShareSheet's dropdown styling (trigger/menu/menuItem) rather than a
// third copy of the same anchored-panel CSS.
export function OverflowMenu({
  streamId,
  creatorId,
  isAuthed,
}: {
  streamId: string;
  creatorId: string;
  isAuthed: boolean;
}) {
  const dropdown = useDropdown<HTMLDivElement>();
  const [reportTarget, setReportTarget] = useState<"stream" | "user" | null>(null);

  function openReport(target: "stream" | "user") {
    dropdown.setOpen(false);
    if (!isAuthed) {
      openAuthModal();
      return;
    }
    setReportTarget(target);
  }

  return (
    <div className={styles.wrap} ref={dropdown.ref}>
      <button type="button" className={styles.trigger} aria-label="More options" onClick={() => dropdown.setOpen((o) => !o)}>
        <MoreIcon />
      </button>
      {dropdown.open && (
        <div className={styles.menu}>
          <button type="button" className={styles.menuItem} onClick={() => openReport("stream")}>
            Report Live Stream
          </button>
          <button type="button" className={styles.menuItem} onClick={() => openReport("user")}>
            Report Something Else
          </button>
        </div>
      )}

      {reportTarget === "stream" && (
        <ReportModal
          targetType="stream"
          targetId={streamId}
          title="Report this live stream"
          onClose={() => setReportTarget(null)}
        />
      )}
      {reportTarget === "user" && (
        <ReportModal
          targetType="user"
          targetId={creatorId}
          title="Report something else"
          onClose={() => setReportTarget(null)}
        />
      )}
    </div>
  );
}
