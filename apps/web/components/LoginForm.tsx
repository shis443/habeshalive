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
// "totp": password (or signup OTP) was accepted but the account has 2FA
// enabled — /api/session returned {requiresTotp, pendingToken} instead of
// a session, and this view collects the 6-digit authenticator code to
// finish via /api/session/2fa.
type LoginView = "password" | "forgot-identifier" | "forgot-code" | "totp";

async function postSession(body: Record<string, unknown>, addAccount: boolean): Promise<Response> {
  return fetch(addAccount ? "/api/session?addAccount=true" : "/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// TEMPORARY — see app/api/diagnostics/log/route.ts. `context` is the
// handler name so the log line says exactly which request path threw,
// since all six of this form's handlers otherwise funnel into the same
// generic catch-and-display. Fire-and-forget: must never itself throw or
// delay the real error banner from showing, and never receives the
// identifier/password being submitted — only the caught error's own
// message and stack.
function reportLoginDiagnostic(context: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? (err.stack ?? "") : "";
  fetch("/api/diagnostics/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context, message, stack }),
  }).catch(() => {});
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M3.5 3.5l17 17M9.9 9.9a3 3 0 0 0 4.2 4.2M6.2 6.4C3.6 8.1 1.5 12 1.5 12s3.5 7 10.5 7c1.9 0 3.5-.5 4.9-1.2M14.8 5.5c-.9-.3-1.8-.5-2.8-.5-7 0-10.5 7-10.5 7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Top-level, not nested in LoginForm — a component defined inside another
// component's body is a brand-new function identity every render, which
// makes React unmount/remount its DOM node (and drop input focus) on
// every keystroke of any sibling field. Password visibility is one shared
// toggle across the whole flow rather than per-field state: only one
// password field is ever on screen at a time (login, reset, or signup —
// never together), so there's nothing to keep independently in sync.
function PasswordField({
  id,
  label,
  value,
  onChange,
  showPassword,
  onToggleShow,
  hasError,
  minLength,
  hint,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  showPassword: boolean;
  onToggleShow: () => void;
  hasError?: boolean;
  minLength?: number;
  hint?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.inputWrap}>
        <input
          id={id}
          type={showPassword ? "text" : "password"}
          required
          minLength={minLength}
          autoFocus={autoFocus}
          className={`${styles.input} ${hasError ? styles.inputError : ""}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className={styles.passwordToggle}
          onClick={onToggleShow}
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          <EyeIcon open={showPassword} />
        </button>
      </div>
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}

// Top-level for the same reason as PasswordField: a stable component
// identity means React updates the existing DOM node across re-renders
// where `error` stays the same truthy string (e.g. typing to correct a
// field), rather than remounting it and replaying the shake animation on
// every keystroke — it should only shake once, when a new error actually
// lands.
function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className={`${styles.error} ${styles.shake}`} role="alert">
      <svg className={styles.errorIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
      </svg>
      {message}
    </p>
  );
}

export function LoginForm({
  mode = "login",
  onSuccess,
  hideCrossLink,
}: {
  mode?: "login" | "signup";
  // E.4: when provided (the auth modal's use case), a completed login/
  // signup calls this instead of hard-navigating to `redirect` — the
  // modal closes and whatever gated action triggered it resumes in
  // place, which is the entire reason to use a modal here rather than
  // just linking to /login with extra steps. The full-page /login and
  // /signup routes still hard-navigate (no onSuccess passed), unchanged.
  onSuccess?: () => void;
  // The modal supplies its own cross-link (a mode toggle, not a page
  // navigation) — suppresses this component's own Link-based one.
  hideCrossLink?: boolean;
}) {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "/dashboard";
  // E.2: appends to whoever's already signed in on this device instead of
  // replacing them — see app/api/session/route.ts's POST handler.
  const addAccount = searchParams.get("addAccount") === "true";

  function completeAuth() {
    if (onSuccess) onSuccess();
    else window.location.href = redirectTo;
  }

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
  const [pendingToken, setPendingToken] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Shared by handleLogin and handleVerifyOtp: both complete via
  // completeLoginOrChallenge on the backend, so either can come back with
  // a real session or a 2FA challenge instead.
  function handleSessionResponse(data: { requiresTotp?: boolean; pendingToken?: string }): void {
    if (data.requiresTotp && data.pendingToken) {
      setPendingToken(data.pendingToken);
      setLoginView("totp");
      return;
    }
    completeAuth();
  }

  async function handleVerifyTotp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(addAccount ? "/api/session/2fa?addAccount=true" : "/api/session/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken, code: totpCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Invalid code");
      completeAuth();
    } catch (err) {
      reportLoginDiagnostic("handleVerifyTotp", err);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

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
      reportLoginDiagnostic("handleRequestOtp", err);
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
      const res = await postSession({ ...identity, code, username, displayName, password }, addAccount);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to verify code");
      handleSessionResponse(data);
    } catch (err) {
      reportLoginDiagnostic("handleVerifyOtp", err);
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
      const res = await postSession({ identifier, password }, addAccount);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to log in");
      handleSessionResponse(data);
    } catch (err) {
      reportLoginDiagnostic("handleLogin", err);
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
      reportLoginDiagnostic("handleRequestPasswordReset", err);
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
      const loginRes = await postSession({ identifier, password: newPassword }, addAccount);
      const loginData = await loginRes.json();
      if (!loginRes.ok) throw new Error(loginData.error ?? "Password reset, but login failed — try logging in");
      handleSessionResponse(loginData);
    } catch (err) {
      reportLoginDiagnostic("handleResetPassword", err);
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
    setPendingToken("");
    setTotpCode("");
  }

  const showingForgotFlow = mode === "login" && loginView !== "password";

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <p className={styles.wordmark}>Birq</p>
        <p className={styles.subtext}>
          {mode === "signup" && "Create your account with your "}
          {mode === "signup" && (method === "phone" ? "phone number" : "email")}
          {loginView === "totp" && "Two-factor authentication required"}
          {loginView !== "totp" && mode === "login" && loginView === "password" && "Sign in to your account"}
          {loginView !== "totp" &&
            mode === "login" &&
            loginView === "forgot-identifier" &&
            "Enter your phone number or email"}
          {loginView !== "totp" &&
            mode === "login" &&
            loginView === "forgot-code" &&
            "Enter the code and a new password"}
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

        {mode === "login" && loginView === "password" && (
          <form className={styles.formStep} key="login-password" onSubmit={handleLogin}>
            <div className={styles.formBody}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="identifier">
                  Phone number or email
                </label>
                <input
                  id="identifier"
                  type="text"
                  required
                  placeholder="+251911234567 or you@example.com"
                  className={`${styles.input} ${error ? styles.inputError : ""}`}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                />
              </div>
              <PasswordField
                id="password"
                label="Password"
                value={password}
                onChange={setPassword}
                showPassword={showPassword}
                onToggleShow={() => setShowPassword((v) => !v)}
                hasError={!!error}
              />
            </div>
            <div className={styles.actionArea}>
              <ErrorBanner key={error} message={error} />
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
            </div>
          </form>
        )}

        {loginView === "totp" && (
          <form className={styles.formStep} key="totp" onSubmit={handleVerifyTotp}>
            <div className={styles.formBody}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="totp-code">
                  Authenticator code
                </label>
                <input
                  id="totp-code"
                  type="text"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="123456"
                  autoFocus
                  className={`${styles.input} ${error ? styles.inputError : ""}`}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                />
                <p className={styles.hint}>Enter the 6-digit code from your authenticator app.</p>
              </div>
            </div>
            <div className={styles.actionArea}>
              <ErrorBanner key={error} message={error} />
              <button type="submit" className={styles.submitButton} disabled={loading || totpCode.length !== 6}>
                {loading ? "Verifying..." : "Verify"}
              </button>
              <button type="button" className={styles.secondaryButton} onClick={backToLogin}>
                Back to log in
              </button>
            </div>
          </form>
        )}

        {mode === "login" && loginView === "forgot-identifier" && (
          <form className={styles.formStep} key="forgot-identifier" onSubmit={handleRequestPasswordReset}>
            <div className={styles.formBody}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="forgot-identifier">
                  Phone number or email
                </label>
                <input
                  id="forgot-identifier"
                  type="text"
                  required
                  placeholder="+251911234567 or you@example.com"
                  className={`${styles.input} ${error ? styles.inputError : ""}`}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                />
              </div>
            </div>
            <div className={styles.actionArea}>
              <ErrorBanner key={error} message={error} />
              <button type="submit" className={styles.submitButton} disabled={loading}>
                {loading ? "Sending..." : "Send code"}
              </button>
              <button type="button" className={styles.secondaryButton} onClick={backToLogin}>
                Back to log in
              </button>
            </div>
          </form>
        )}

        {mode === "login" && loginView === "forgot-code" && (
          <form className={styles.formStep} key="forgot-code" onSubmit={handleResetPassword}>
            <div className={styles.formBody}>
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
                  className={`${styles.input} ${error ? styles.inputError : ""}`}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
              <PasswordField
                id="new-password"
                label="New password"
                value={newPassword}
                onChange={setNewPassword}
                showPassword={showPassword}
                onToggleShow={() => setShowPassword((v) => !v)}
                hasError={!!error}
                minLength={8}
              />
            </div>
            <div className={styles.actionArea}>
              <ErrorBanner key={error} message={error} />
              <button type="submit" className={styles.submitButton} disabled={loading}>
                {loading ? "Resetting..." : "Reset password & log in"}
              </button>
              <button type="button" className={styles.secondaryButton} onClick={backToLogin}>
                Back to log in
              </button>
            </div>
          </form>
        )}

        {mode === "signup" && signupStep === "identifier" && (
          <form className={styles.formStep} key="signup-identifier" onSubmit={handleRequestOtp}>
            <div className={styles.formBody}>
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
                    className={`${styles.input} ${error ? styles.inputError : ""}`}
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
                    className={`${styles.input} ${error ? styles.inputError : ""}`}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className={styles.actionArea}>
              <ErrorBanner key={error} message={error} />
              <button type="submit" className={styles.submitButton} disabled={loading}>
                {loading ? "Sending..." : "Send code"}
              </button>
            </div>
          </form>
        )}

        {mode === "signup" && signupStep === "code" && (
          <form className={styles.formStep} key="signup-code" onSubmit={handleVerifyOtp}>
            <div className={styles.formBody}>
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
                  className={`${styles.input} ${error ? styles.inputError : ""}`}
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
                  className={`${styles.input} ${error ? styles.inputError : ""}`}
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
              <PasswordField
                id="signup-password"
                label="Password"
                value={password}
                onChange={setPassword}
                showPassword={showPassword}
                onToggleShow={() => setShowPassword((v) => !v)}
                hasError={!!error}
                minLength={8}
                hint="At least 8 characters. You'll use this to log in next time."
              />
            </div>
            <div className={styles.actionArea}>
              <ErrorBanner key={error} message={error} />
              <p className={styles.terms}>
                By clicking Verify &amp; continue, you are indicating that you have read and acknowledge the{" "}
                <Link href="/terms" target="_blank" rel="noopener noreferrer">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link href="/privacy" target="_blank" rel="noopener noreferrer">
                  Privacy Notice
                </Link>
                .
              </p>
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
            </div>
          </form>
        )}

        {!showingForgotFlow && !hideCrossLink && (
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
