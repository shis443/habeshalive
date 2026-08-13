"use client";

import {
  birrToSantim,
  formatSantimAsBirr,
  STREAM_CATEGORIES,
  STREAM_LANGUAGES,
  type AdCampaignAdminItem,
  type AdCreativeAdminItem,
  type AdFormat,
  type Advertiser,
} from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { unwrapClientData } from "@/lib/clientApi";
import styles from "./AdminQueue.module.css";
import filterStyles from "./PayoutHistoryFilters.module.css";
import formStyles from "./ManualAdjustmentForm.module.css";

const FORMATS: AdFormat[] = ["preroll", "midroll", "display_banner", "sponsored_card", "overlay"];
const STATUSES = ["draft", "pending_review", "active", "paused", "completed"] as const;

export function AdCampaignsPanel({
  campaigns,
  advertisers,
}: {
  campaigns: AdCampaignAdminItem[];
  advertisers: Advertiser[];
}) {
  const router = useRouter();
  const [advertiserId, setAdvertiserId] = useState(advertisers[0]?.id ?? "");
  const [name, setName] = useState("");
  const [budgetBirr, setBudgetBirr] = useState("");
  const [cpmBirr, setCpmBirr] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [category, setCategory] = useState("");
  const [language, setLanguage] = useState("");
  const [minViewers, setMinViewers] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function createCampaign() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/admin/ad-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advertiserId,
          name,
          budgetSantim: birrToSantim(parseFloat(budgetBirr || "0")),
          cpmSantim: birrToSantim(parseFloat(cpmBirr || "0")),
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          targeting: {
            category: category || undefined,
            language: language || undefined,
            minViewers: minViewers ? Number(minViewers) : undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create campaign");
      setName("");
      setBudgetBirr("");
      setCpmBirr("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function setStatus(campaignId: string, status: string) {
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/ad-campaigns/${campaignId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update status");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (advertisers.length === 0) {
    return <p className={styles.empty}>Add an advertiser first before creating a campaign.</p>;
  }

  return (
    <div>
      <div className={formStyles.form}>
        <div className={formStyles.row}>
          <select className={filterStyles.select} value={advertiserId} onChange={(e) => setAdvertiserId(e.target.value)}>
            {advertisers.map((adv) => (
              <option key={adv.id} value={adv.id}>
                {adv.name}
              </option>
            ))}
          </select>
          <input className={filterStyles.input} placeholder="Campaign name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className={formStyles.row}>
          <input
            type="number"
            className={filterStyles.input}
            placeholder="Budget (ETB)"
            value={budgetBirr}
            onChange={(e) => setBudgetBirr(e.target.value)}
          />
          <input
            type="number"
            className={filterStyles.input}
            placeholder="CPM (ETB / 1000 impressions)"
            value={cpmBirr}
            onChange={(e) => setCpmBirr(e.target.value)}
          />
        </div>
        <div className={formStyles.row}>
          <input type="date" className={filterStyles.input} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          <input type="date" className={filterStyles.input} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </div>
        <div className={formStyles.row}>
          <select className={filterStyles.select} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Any category</option>
            {STREAM_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select className={filterStyles.select} value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">Any language</option>
            {STREAM_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <input
            type="number"
            className={filterStyles.input}
            placeholder="Min viewers"
            value={minViewers}
            onChange={(e) => setMinViewers(e.target.value)}
          />
        </div>
        <button
          type="button"
          className={styles.approveButton}
          disabled={submitting || !name || !budgetBirr || !cpmBirr || !startsAt || !endsAt}
          onClick={createCampaign}
        >
          Create campaign (draft)
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </div>

      <div className={styles.list}>
        {campaigns.map((camp) => (
          <div key={camp.id} className={styles.rowStack}>
            <div className={`${styles.row} ${styles.rowExpandable}`} onClick={() => setExpandedId(expandedId === camp.id ? null : camp.id)}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>
                  {camp.name} — {camp.advertiserName}
                </span>
                <span className={styles.rowMeta}>
                  {formatSantimAsBirr(camp.spentSantim)} / {formatSantimAsBirr(camp.budgetSantim)} spent ·{" "}
                  {formatSantimAsBirr(camp.cpmSantim)} CPM · {camp.impressionCount} impressions · {camp.clickCount} clicks ·{" "}
                  {camp.creativeCount} creatives · {camp.status}
                  {camp.targeting &&
                    ` · targets ${[camp.targeting.category, camp.targeting.language, camp.targeting.minViewers ? `${camp.targeting.minViewers}+ viewers` : null]
                      .filter(Boolean)
                      .join(", ")}`}
                </span>
              </div>
            </div>
            {expandedId === camp.id && (
              <div className={formStyles.form} onClick={(e) => e.stopPropagation()}>
                <div className={formStyles.row}>
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={camp.status === s ? styles.approveButton : styles.denyButton}
                      onClick={() => setStatus(camp.id, s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <CreativeManager campaignId={camp.id} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CreativeManager({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [creatives, setCreatives] = useState<AdCreativeAdminItem[] | null>(null);
  const [format, setFormat] = useState<AdFormat>("display_banner");
  const [assetUrl, setAssetUrl] = useState("");
  const [clickUrl, setClickUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/backend/admin/ad-campaigns/${campaignId}/creatives`);
    if (res.ok) setCreatives(await unwrapClientData<AdCreativeAdminItem[]>(res));
  }
  if (creatives === null) {
    load();
    return <p className={formStyles.warning}>Loading creatives...</p>;
  }

  async function createCreative() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/admin/ad-creatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, format, assetUrl, clickUrl: clickUrl || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create creative");
      setAssetUrl("");
      setClickUrl("");
      await load();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function approve(id: string) {
    await fetch(`/api/backend/admin/ad-creatives/${id}/approve`, { method: "POST" });
    await load();
    router.refresh();
  }

  return (
    <div>
      <label className={formStyles.fieldLabel}>Creatives</label>
      {creatives.length === 0 && <p className={styles.empty}>No creatives yet.</p>}
      {creatives.map((c) => (
        <div key={c.id} className={styles.row}>
          <div className={styles.rowMain}>
            <span className={styles.rowTitle}>{c.format}</span>
            <span className={styles.rowMeta}>{c.approved ? "Approved" : "Pending approval"}</span>
          </div>
          {!c.approved && (
            <button type="button" className={styles.approveButton} onClick={() => approve(c.id)}>
              Approve
            </button>
          )}
        </div>
      ))}
      <div className={formStyles.row}>
        <select className={filterStyles.select} value={format} onChange={(e) => setFormat(e.target.value as AdFormat)}>
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <input
          className={filterStyles.input}
          placeholder="Asset URL (image/video)"
          value={assetUrl}
          onChange={(e) => setAssetUrl(e.target.value)}
        />
        <input
          className={filterStyles.input}
          placeholder="Click-through URL (optional)"
          value={clickUrl}
          onChange={(e) => setClickUrl(e.target.value)}
        />
      </div>
      <button type="button" className={styles.approveButton} disabled={submitting || !assetUrl} onClick={createCreative}>
        Add creative
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
