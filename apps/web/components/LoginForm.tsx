"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { API_BASE_URL } from "@/lib/config";
import styles from "./LoginForm.module.css";

type Method = "phone" | "email";
type SignupStep = "identifier" | "code";
// "password": normal returning-user login, the default view.
// "forgot-identifier"/"forgot-code": password recovery, reachable via the
// "Forgot password?" link — sends an OTP, verifies it, sets a new
// password, then logs in with it immediately (no separate "now log back
// in" step).
type LoginView = "password" | "forgot-identifier" | "forgot-code";

async function postSession(body: Record<string, unknown>): Promise<Response> {
  return fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function LoginForm({ mode = "login" }: { mode?: "login" | "signup" }) {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "/dashboard";

  const [method, setMethod] = useState<Method>("phone");
  const [signupStep, setSignupStep] = useState<SignupStep>("identifier");
  const [loginView, setLoginView] = useState<LoginView>("password");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function switchMethod(next: Method) {
    setMethod(next);
    setSignupStep("identifier");
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
      setSignupStep("code");
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
      const identity = method === "phone" ? { phoneNumber } : { email };
      const res = await postSession({ ...identity, code, username, displayName, password });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to verify code");
      window.location.href = redirectTo;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await postSession({ identifier, password });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to log in");
      window.location.href = redirectTo;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestPasswordReset(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/password/forgot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send code");
      setLoginView("forgot-code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const resetRes = await fetch(`${API_BASE_URL}/auth/password/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, code, newPassword }),
      });
      const resetData = await resetRes.json();
      if (!resetRes.ok) throw new Error(resetData.error ?? "Failed to reset password");

      // Reset succeeded — log straight in with the new password rather
      // than sending someone back to a login screen right after they just
      // proved who they are.
      const loginRes = await postSession({ identifier, password: newPassword });
      const loginData = await loginRes.json();
      if (!loginRes.ok) throw new Error(loginData.error ?? "Password reset, but login failed — try logging in");
      window.location.href = redirectTo;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function backToLogin() {
    setLoginView("password");
    setError(null);
    setCode("");
    setNewPassword("");
  }

  const showingForgotFlow = mode === "login" && loginView !== "password";

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <p className={styles.wordmark}>Birq</p>
        <p className={styles.subtext}>
          {mode === "signup" && "Create your account with your "}
          {mode === "signup" && (method === "phone" ? "phone number" : "email")}
          {mode === "login" && loginView === "password" && "Sign in to your account"}
          {mode === "login" && loginView === "forgot-identifier" && "Enter your phone number or email"}
          {mode === "login" && loginView === "forgot-code" && "Enter the code and a new password"}
        </p>

        {mode === "signup" && signupStep === "identifier" && (
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

        {mode === "login" && loginView === "password" && (
          <form onSubmit={handleLogin}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="identifier">
                Phone number or email
              </label>
              <input
                id="identifier"
                type="text"
                required
                placeholder="+251911234567 or you@example.com"
                className={styles.input}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                className={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? "Logging in..." : "Log in"}
            </button>
            <button
              type="button"
              className={styles.forgotLink}
              onClick={() => {
                setLoginView("forgot-identifier");
                setError(null);
              }}
            >
              Forgot password?
            </button>
          </form>
        )}

        {mode === "login" && loginView === "forgot-identifier" && (
          <form onSubmit={handleRequestPasswordReset}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="forgot-identifier">
                Phone number or email
              </label>
              <input
                id="forgot-identifier"
                type="text"
                required
                placeholder="+251911234567 or you@example.com"
                className={styles.input}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </div>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? "Sending..." : "Send code"}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={backToLogin}>
              Back to log in
            </button>
          </form>
        )}

        {mode === "login" && loginView === "forgot-code" && (
          <form onSubmit={handleResetPassword}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="reset-code">
                6-digit code
              </label>
              <input
                id="reset-code"
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
              <label className={styles.label} htmlFor="new-password">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                required
                minLength={8}
                className={styles.input}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? "Resetting..." : "Reset password & log in"}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={backToLogin}>
              Back to log in
            </button>
          </form>
        )}

        {mode === "signup" && signupStep === "identifier" && (
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
        )}

        {mode === "signup" && signupStep === "code" && (
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
                Username
              </label>
              <input
                id="username"
                type="text"
                required
                placeholder="dawit_gamer"
                className={styles.input}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="displayName">
                Display name
              </label>
              <input
                id="displayName"
                type="text"
                required
                placeholder="Dawit"
                className={styles.input}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="signup-password">
                Password
              </label>
              <input
                id="signup-password"
                type="password"
                required
                minLength={8}
                className={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className={styles.hint}>At least 8 characters. You&apos;ll use this to log in next time.</p>
            </div>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? "Verifying..." : "Verify & continue"}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setSignupStep("identifier")}
            >
              Use a different {method === "phone" ? "number" : "email"}
            </button>
          </form>
        )}

        {!showingForgotFlow && (
          <p className={styles.crossLink}>
            {mode === "signup" ? (
              <>
                Already have an account? <Link href="/login">Log in</Link>
              </>
            ) : (
              <>
                New here? <Link href="/signup">Create an account</Link>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
