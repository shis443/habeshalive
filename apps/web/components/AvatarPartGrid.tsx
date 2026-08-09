import type { AvatarCategory, AvatarPart, AvatarValues } from "@birq/shared";
import { formatAvatarOptionLabel } from "@/lib/avatar";
import styles from "./AvatarPartGrid.module.css";
import { BlockedIcon } from "./icons";
import { OptionThumbnail } from "./OptionThumbnail";

// "None"/"blank" are real, selectable avatar_parts rows (a genuine
// "no facial hair" choice, not a null sentinel — see db/migrations/0029_
// avataaars_render.sql's comment), but still worth the same blocked-icon
// treatment the old flat-swatch model used for its "None" background/hair
// rows — a visual "this category is off" cue is clearer than a rendered
// avatar that looks identical to several other options (a bare face
// reads as ambiguous, not obviously "nothing selected").
const NONE_NAMES = new Set(["none", "blank"]);

export function AvatarPartGrid({
  category,
  parts,
  selectedId,
  baseValues,
  onSelect,
}: {
  category: AvatarCategory;
  parts: AvatarPart[];
  selectedId: string | null;
  // The current full draft — every style-option tile previews itself
  // composited onto this (your actual current skin tone, hair color,
  // etc.), not a generic default face. See OptionThumbnail.tsx's own
  // comment for why this is a full re-composition rather than an
  // isolated feature fragment.
  baseValues: AvatarValues;
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
              <OptionThumbnail category={category} optionName={part.name} baseValues={baseValues} />
            )}
            <span className={styles.tileName}>{isNone ? "None" : formatAvatarOptionLabel(part.name)}</span>
          </button>
        );
      })}
    </div>
  );
}
