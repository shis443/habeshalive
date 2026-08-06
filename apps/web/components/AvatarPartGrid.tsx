import type { AvatarPart } from "@habeshalive/shared";
import { formatAvatarOptionLabel } from "@/lib/avatar";
import styles from "./AvatarPartGrid.module.css";
import { BlockedIcon } from "./icons";

// "None"/"blank" are real, selectable avatar_parts rows (a genuine
// "no facial hair" choice, not a null sentinel — see db/migrations/0029_
// avataaars_render.sql's comment), but still worth the same blocked-icon
// treatment the old flat-swatch model used for its "None" background/hair
// rows — a visual "this category is off" cue is clearer than the literal
// word "Blank" as a tile label.
const NONE_NAMES = new Set(["none", "blank"]);

export function AvatarPartGrid({
  parts,
  selectedId,
  onSelect,
}: {
  parts: AvatarPart[];
  selectedId: string | null;
  onSelect: (part: AvatarPart) => void;
}) {
  return (
    <div className={styles.grid}>
      {parts.map((part) => {
        const isNone = NONE_NAMES.has(part.name.toLowerCase());
        return (
          <button
            key={part.id}
            type="button"
            className={`${styles.tile} ${part.id === selectedId ? styles.tileSelected : ""}`}
            onClick={() => onSelect(part)}
          >
            {part.swatchColor ? (
              <span className={styles.swatch} style={{ background: part.swatchColor }} />
            ) : isNone ? (
              <BlockedIcon className={styles.noneIcon} />
            ) : (
              // No per-option thumbnail art exists for style categories
              // (that would mean rendering + caching a full mini-avatar
              // per option, out of scope for this pass) — a monogram chip
              // is a cheap, still-legible stand-in that isn't just an
              // empty circle.
              <span className={styles.styleIcon} aria-hidden="true">
                {formatAvatarOptionLabel(part.name).charAt(0)}
              </span>
            )}
            <span className={styles.tileName}>{isNone ? "None" : formatAvatarOptionLabel(part.name)}</span>
          </button>
        );
      })}
    </div>
  );
}
