"use client";

import {
  renderAvatarSvg,
  type AvatarCategory,
  type AvatarManifest,
  type AvatarPart,
  type AvatarSelection,
  type AvatarValues,
} from "@habeshalive/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AvatarCategoryTabs } from "./AvatarCategoryTabs";
import { AvatarPartGrid } from "./AvatarPartGrid";
import { AvatarPreviewHero } from "./AvatarPreviewHero";
import styles from "./AvatarEditor.module.css";
import { BackIcon, CheckIcon, ShuffleIcon } from "./icons";

const CATEGORIES: AvatarCategory[] = [
  "background",
  "skin_tone",
  "hair",
  "hair_color",
  "eyes",
  "eyebrows",
  "mouth",
  "facial_hair",
  "accessories",
  "clothing",
  "clothes_color",
];

// Mirrors apps/api/src/avatars/service.ts's COLOR_CATEGORIES — this
// client-side render call needs the exact same category/value-type split
// as the server-side one, since both go through the identical shared
// renderAvatarSvg() and must produce identical output (that's the whole
// point of sharing the function — see avatarRender.ts's own comment).
const COLOR_CATEGORIES = new Set<AvatarCategory>(["background", "skin_tone", "hair_color", "clothes_color"]);

type Draft = Record<AvatarCategory, string>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickRandomDraft(manifest: AvatarManifest): Draft {
  const draft = {} as Draft;
  for (const category of CATEGORIES) {
    const options = manifest[category] ?? [];
    if (options.length === 0) continue;
    draft[category] = options[Math.floor(Math.random() * options.length)]!.id;
  }
  return draft;
}

function resolveValues(manifest: AvatarManifest, draft: Draft): AvatarValues {
  const values = {} as AvatarValues;
  for (const category of CATEGORIES) {
    const options = manifest[category] ?? [];
    const part = options.find((p) => p.id === draft[category]);
    values[category] = part ? (COLOR_CATEGORIES.has(category) ? part.swatchColor : part.name) : null;
  }
  return values;
}

export function AvatarEditor({
  manifest,
  initialSelection,
}: {
  manifest: AvatarManifest;
  initialSelection: AvatarSelection;
}) {
  const router = useRouter();

  const initialDraft = useMemo(() => {
    const draft = {} as Draft;
    for (const category of CATEGORIES) {
      const fallback = manifest[category]?.[0]?.id;
      draft[category] = initialSelection[category] ?? fallback ?? "";
    }
    return draft;
  }, [manifest, initialSelection]);

  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [activeCategory, setActiveCategory] = useState<AvatarCategory>(CATEGORIES[0]!);
  const [pulsing, setPulsing] = useState(false);
  const [randomizing, setRandomizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const svg = useMemo(() => renderAvatarSvg(resolveValues(manifest, draft)), [manifest, draft]);

  function handleSelectPart(category: AvatarCategory, part: AvatarPart) {
    setDraft((prev) => ({ ...prev, [category]: part.id }));
    setPulsing(true);
    setTimeout(() => setPulsing(false), 220);
  }

  async function handleRandomize() {
    setRandomizing(true);
    for (let i = 0; i < 2; i++) {
      setDraft(pickRandomDraft(manifest));
      await sleep(120);
    }
    setDraft(pickRandomDraft(manifest));
    setRandomizing(false);
  }

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/backend/avatars/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection: draft }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to save avatar");
      }
      setSaveMessage("Saved!");
      router.refresh();
      setTimeout(() => setSaveMessage(null), 2000);
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <Link href="/dashboard" className={styles.headerButton} aria-label="Back">
          <BackIcon />
        </Link>
        <span className={styles.headerTitle}>Edit Avatar</span>
        <button type="button" className={styles.headerButton} onClick={handleSave} aria-label="Done" disabled={saving}>
          <CheckIcon />
        </button>
      </header>

      <div className={styles.page}>
        <AvatarPreviewHero svg={svg} pulsing={pulsing || randomizing} />

        <div className={styles.actionRow}>
          <button type="button" className={styles.randomizeButton} onClick={handleRandomize} disabled={randomizing}>
            <ShuffleIcon />
            Randomize
          </button>
          <button type="button" className={styles.saveButton} onClick={handleSave} disabled={saving}>
            <CheckIcon />
            {saving ? "Saving..." : "Save"}
          </button>
        </div>

        {saveMessage && <p className={styles.saveMessage}>{saveMessage}</p>}

        <div className={styles.panel}>
          <div className={styles.panelGlow} />
          <AvatarCategoryTabs categories={CATEGORIES} active={activeCategory} onChange={setActiveCategory} />
          <AvatarPartGrid
            parts={manifest[activeCategory] ?? []}
            selectedId={draft[activeCategory] ?? null}
            onSelect={(part) => handleSelectPart(activeCategory, part)}
          />
        </div>
      </div>
    </>
  );
}
