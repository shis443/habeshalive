import type { Squad } from "@birq/shared";
import { VideoPlayer } from "./VideoPlayer";
import styles from "./SquadGrid.module.css";

// Module 3 — grid-view squad co-streaming. Each tile is an ordinary
// VideoPlayer against that member's own existing stream (already gated
// for PPV/etc. server-side in squad-service.ts's buildSquad) — no shared
// player state, no new real-time transport, just N independent players
// in a CSS grid. A member with no current live stream (ended their
// broadcast but hasn't left the squad) renders as an offline tile
// instead of dropping out of the grid.
export function SquadGrid({ squad }: { squad: Squad }) {
  return (
    <div className={styles.grid} data-count={squad.members.length}>
      {squad.members.map((member) => (
        <div key={member.creatorId} className={styles.tile}>
          {member.stream ? (
            <VideoPlayer src={member.stream.playbackUrl} streamId={member.stream.id} />
          ) : (
            <div className={styles.offline}>
              <span>@{member.username}</span>
              <span className={styles.offlineLabel}>Offline</span>
            </div>
          )}
          <span className={styles.nameTag}>@{member.username}</span>
        </div>
      ))}
    </div>
  );
}
