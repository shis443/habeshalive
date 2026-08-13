import type { LiveStream } from "@birq/shared";
import { StreamCard } from "./StreamCard";
import styles from "./FeaturedLiveRail.module.css";

// Discover's "Featured live" section — same real boosted-stream data
// app/discover/page.tsx already fetches (GET /streams/live filtered
// client-side to isBoosted), just laid out as a horizontally-scrolling
// rail (Twitch-Clone-Flutter's peeking PageView carousel, adapted: native
// scroll-snap instead of a swipe library, since every card here already
// needs to stay keyboard/focus navigable like the rest of the site — a
// carousel library would mean a second interaction model to keep
// accessible). Reuses StreamCard as-is, so live preview-on-visible,
// tap-through to /watch/[username], and the live/boosted/sensitive badges
// all keep working exactly as they do in the grid layouts.
export function FeaturedLiveRail({ streams }: { streams: LiveStream[] }) {
  return (
    <div className={styles.rail} role="list">
      {streams.map((stream) => (
        <div key={stream.id} className={styles.item} role="listitem">
          <StreamCard stream={stream} />
        </div>
      ))}
    </div>
  );
}
