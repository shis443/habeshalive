import { renderAvatarSvg, type AvatarCategory, type AvatarValues } from "@birq/shared";
import { useMemo } from "react";
import styles from "./OptionThumbnail.module.css";

// Deliberately a full mini-avatar (the user's current draft, with only
// this one category swapped to the option this tile represents), not an
// isolated feature fragment (just the hair shape, just the eyes, on a
// blank background). @dicebear/avataaars's per-option component
// functions (e.g. lib/components/eyes.js's `happy: (components, colors)
// => "<path .../>"`) exist but are internal, undocumented, and not
// exported from the package's public entry point — reaching them would
// mean a deep import into a path this package's own semver guarantees
// don't cover, liable to silently break on any future version bump. Full
// composition through the same public renderAvatarSvg() the main preview
// already uses is the stable, supported path, and arguably more useful
// anyway: a tile shows exactly what your actual avatar would look like
// with that option picked (your real skin tone, hair color, etc.), not a
// disconnected shape.
export function OptionThumbnail({
  category,
  optionName,
  baseValues,
}: {
  category: AvatarCategory;
  optionName: string;
  baseValues: AvatarValues;
}) {
  const svg = useMemo(
    () => renderAvatarSvg({ ...baseValues, [category]: optionName }),
    [category, optionName, baseValues]
  );

  return <span className={styles.thumbnail} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}
