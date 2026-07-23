import type { AvatarPart } from "@habeshalive/shared";
import styles from "./AvatarPartGrid.module.css";
import { BlockedIcon } from "./icons";

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
      {parts.map((part) => (
        <button
          key={part.id}
          type="button"
          className={`${styles.tile} ${part.id === selectedId ? styles.tileSelected : ""}`}
          onClick={() => onSelect(part)}
        >
          {part.swatchColor ? (
            <span className={styles.swatch} style={{ background: part.swatchColor }} />
          ) : (
            <BlockedIcon className={styles.noneIcon} />
          )}
          <span className={styles.tileName}>{part.name}</span>
        </button>
      ))}
    </div>
  );
}
