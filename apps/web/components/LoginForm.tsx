"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { API_BASE_URL } from "@/lib/config";
import styles from "./LoginForm.module.css";

type Step = "phone" | "code";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "/dashboard";

  const [step, setStep] = useState<Step>("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRequestOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send code");
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber,
          code,
          username: username || undefined,
          displayName: displayName || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to verify code");
      router.push(redirectTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <p className={styles.wordmark}>HabeshaLive</p>
        <p className={styles.subtext}>Sign in with your phone number</p>

        {error && <p className={styles.error}>{error}</p>}

        {step === "phone" ? (
          <form onSubmit={handleRequestOtp}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="phone">
                Phone number
              </label>
              <input
                id="phone"
                type="tel"
                required
                placeholder="+251911234567"
                className={styles.input}
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
              <p className={styles.hint}>Ethiopian mobile number, e.g. +251911234567</p>
            </div>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? "Sending..." : "Send code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="code">
                6-digit code
              </label>
              <input
                id="code"
                type="text"
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="123456"
                className={styles.input}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="username">
                Username (new accounts only)
              </label>
              <input
                id="username"
                type="text"
                placeholder="dawit_gamer"
                className={styles.input}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="displayName">
                Display name (new accounts only)
              </label>
              <input
                id="displayName"
                type="text"
                placeholder="Dawit"
                className={styles.input}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? "Verifying..." : "Verify & continue"}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={() => setStep("phone")}>
              Use a different number
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
