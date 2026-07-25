"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { API_BASE_URL } from "@/lib/config";
import styles from "./LoginForm.module.css";

type Method = "phone" | "email";
type Step = "identifier" | "code";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "/dashboard";

  const [method, setMethod] = useState<Method>("phone");
  const [step, setStep] = useState<Step>("identifier");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function switchMethod(next: Method) {
    setMethod(next);
    setStep("identifier");
    setError(null);
    setCode("");
  }

  async function handleRequestOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const path = method === "phone" ? "/auth/request-otp" : "/auth/request-email-otp";
      const body = method === "phone" ? { phoneNumber } : { email };
      const res = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      const identifier = method === "phone" ? { phoneNumber } : { email };
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...identifier,
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
        <p className={styles.subtext}>
          Sign in with your {method === "phone" ? "phone number" : "email"}
        </p>

        {step === "identifier" && (
          <div className={styles.methodToggle}>
            <button
              type="button"
              className={`${styles.methodButton} ${method === "phone" ? styles.methodButtonActive : ""}`}
              onClick={() => switchMethod("phone")}
            >
              Phone
            </button>
            <button
              type="button"
              className={`${styles.methodButton} ${method === "email" ? styles.methodButtonActive : ""}`}
              onClick={() => switchMethod("email")}
            >
              Email
            </button>
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}

        {step === "identifier" ? (
          <form onSubmit={handleRequestOtp}>
            {method === "phone" ? (
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
            ) : (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="email">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  placeholder="you@example.com"
                  className={styles.input}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            )}
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
            <button type="button" className={styles.secondaryButton} onClick={() => setStep("identifier")}>
              Use a different {method === "phone" ? "number" : "email"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
