"use client";

import type { MyAccount } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AccountSection.module.css";

type Field = "phone" | "email";

// E.1: each change requires OTP verification of the NEW value before it
// replaces the old one — request sends a code to the new phone/email,
// confirm consumes it. The account's live phoneNumber/email never changes
// until confirm succeeds (see auth/service.ts's pending_phone_number /
// pending_email columns).
export function ContactSection({ account }: { account: MyAccount }) {
  const router = useRouter();
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [pending, setPending] = useState<Field | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Record<Field, string | null>>({ phone: null, email: null });

  async function requestChange(field: Field) {
    setSaving(true);
    setError((e) => ({ ...e, [field]: null }));
    try {
      const path = field === "phone" ? "/auth/account/phone/request" : "/auth/account/email/request";
      const body = field === "phone" ? { phoneNumber: newPhone } : { email: newEmail };
      const res = await fetch(`/api/backend${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send code");
      setPending(field);
    } catch (err) {
      setError((e) => ({ ...e, [field]: err instanceof Error ? err.message : "Something went wrong" }));
    } finally {
      setSaving(false);
    }
  }

  async function confirmChange(field: Field) {
    setSaving(true);
    setError((e) => ({ ...e, [field]: null }));
    try {
      const path = field === "phone" ? "/auth/account/phone/confirm" : "/auth/account/email/confirm";
      const code = field === "phone" ? phoneCode : emailCode;
      const res = await fetch(`/api/backend${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to verify code");
      setPending(null);
      setNewPhone("");
      setNewEmail("");
      setPhoneCode("");
      setEmailCode("");
      router.refresh();
    } catch (err) {
      setError((e) => ({ ...e, [field]: err instanceof Error ? err.message : "Something went wrong" }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Phone &amp; email</h2>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Phone number</span>
        <p className={styles.currentValue}>{account.phoneNumber ?? "Not set"}</p>
        {pending === "phone" ? (
          <>
            <div className={styles.row}>
              <input
                type="text"
                className={styles.input}
                placeholder="6-digit code"
                value={phoneCode}
                onChange={(e) => setPhoneCode(e.target.value)}
                maxLength={6}
              />
              <button type="button" className={styles.button} onClick={() => confirmChange("phone")} disabled={saving}>
                Confirm
              </button>
            </div>
            <p className={styles.pendingNote}>Code sent to {account.pendingPhoneNumber}.</p>
          </>
        ) : (
          <div className={styles.row}>
            <input
              type="tel"
              className={styles.input}
              placeholder="+251911234567"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
            />
            <button
              type="button"
              className={styles.buttonSecondary}
              onClick={() => requestChange("phone")}
              disabled={saving || !newPhone}
            >
              {account.phoneNumber ? "Change" : "Add"}
            </button>
          </div>
        )}
        {error.phone && <p className={styles.error}>{error.phone}</p>}
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Email</span>
        <p className={styles.currentValue}>{account.email ?? "Not set"}</p>
        {pending === "email" ? (
          <>
            <div className={styles.row}>
              <input
                type="text"
                className={styles.input}
                placeholder="6-digit code"
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value)}
                maxLength={6}
              />
              <button type="button" className={styles.button} onClick={() => confirmChange("email")} disabled={saving}>
                Confirm
              </button>
            </div>
            <p className={styles.pendingNote}>Code sent to {account.pendingEmail}.</p>
          </>
        ) : (
          <div className={styles.row}>
            <input
              type="email"
              className={styles.input}
              placeholder="you@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <button
              type="button"
              className={styles.buttonSecondary}
              onClick={() => requestChange("email")}
              disabled={saving || !newEmail}
            >
              {account.email ? "Change" : "Add"}
            </button>
          </div>
        )}
        {error.email && <p className={styles.error}>{error.email}</p>}
      </div>
    </div>
  );
}
