"use client";

import {
  renderAvatarSvg,
  type AvatarCategory,
  type AvatarManifest,
  type AvatarPart,
  type AvatarSelection,
  type AvatarValues,
} from "@birq/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ChangeEvent } from "react";
import { resolveAvatarUrl } from "@/lib/avatar";
import { unwrapClientData } from "@/lib/clientApi";
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
  initialAvatarUrl,
}: {
  manifest: AvatarManifest;
  initialSelection: AvatarSelection;
  initialAvatarUrl: string | null;
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
  const [photoUrl, setPhotoUrl] = useState(initialAvatarUrl);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Module 5 — an uploaded photo (apps/api/src/avatars/service.ts's
  // uploadAvatarPhoto) always sets avatar_url to this exact prefix; the
  // generated-parts avatar uses /avatars/render/:userId.svg instead. This
  // is how the UI tells the two apart without a separate DB flag.
  const hasUploadedPhoto = photoUrl?.startsWith("/avatars/photo/") ?? false;

  // Shared between the big preview and every per-option thumbnail in the
  // grid below (OptionThumbnail.tsx composites each tile onto this same
  // draft, varying only its own category) — computed once per draft
  // change, not once per tile.
  const currentValues = useMemo(() => resolveValues(manifest, draft), [manifest, draft]);
  const svg = useMemo(() => renderAvatarSvg(currentValues), [currentValues]);

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

  async function handlePhotoSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingPhoto(true);
    setPhotoError(null);
    try {
      const formData = new FormData();
      formData.append("photo", file);
      const res = await fetch("/api/backend/avatars/photo", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to upload photo");
      }
      const data = await unwrapClientData<{ avatarUrl: string }>(res);
      setPhotoUrl(data.avatarUrl);
      router.refresh();
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleRevertPhoto() {
    setUploadingPhoto(true);
    setPhotoError(null);
    try {
      const res = await fetch("/api/backend/avatars/photo/revert", { method: "POST" });
      if (!res.ok) throw new Error("Failed to revert photo");
      setPhotoUrl(null);
      router.refresh();
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setUploadingPhoto(false);
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

        <div className={styles.photoSection}>
          {hasUploadedPhoto && photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={resolveAvatarUrl(photoUrl) ?? undefined} alt="Uploaded profile photo" className={styles.photoPreview} />
          )}
          <div className={styles.photoActions}>
            <label className={styles.photoUploadButton}>
              {uploadingPhoto ? "Uploading…" : hasUploadedPhoto ? "Replace photo" : "Upload a photo"}
              <input
                type="file"
                accept="image/jpeg,image/png"
                onChange={handlePhotoSelect}
                disabled={uploadingPhoto}
                className={styles.photoInput}
              />
            </label>
            {hasUploadedPhoto && (
              <button
                type="button"
                className={styles.photoRevertButton}
                onClick={handleRevertPhoto}
                disabled={uploadingPhoto}
              >
                Use generated avatar instead
              </button>
            )}
          </div>
          {photoError && <p className={styles.error}>{photoError}</p>}
        </div>

        <div className={styles.panel}>
          <div className={styles.panelGlow} />
          <AvatarCategoryTabs categories={CATEGORIES} active={activeCategory} onChange={setActiveCategory} />
          <AvatarPartGrid
            category={activeCategory}
            parts={manifest[activeCategory] ?? []}
            selectedId={draft[activeCategory] ?? null}
            baseValues={currentValues}
            onSelect={(part) => handleSelectPart(activeCategory, part)}
          />
        </div>
      </div>
    </>
  );
}
