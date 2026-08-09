import type { StreamActivityEvent } from "@birq/shared";
import styles from "./StreamActivityStrip.module.css";

export function StreamActivityStrip({ events }: { events: StreamActivityEvent[] }) {
  if (events.length === 0) return null;

  return (
    <div className={styles.strip}>
      {events.map((event) => (
        <span key={event.id} className={styles.pill}>
          {event.type === "gift" ? "🎁" : "⭐"} {event.username} {event.label}
        </span>
      ))}
    </div>
  );
}
