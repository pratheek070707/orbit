"use client";

import { useEffect, useState } from "react";

type AuthHealth = {
  services?: Record<string, { status: string; message: string }>;
};

const authErrors: Record<string, string> = {
  github_not_configured: "GitHub sign-in is not configured on this server.",
  github_cancelled: "GitHub sign-in was cancelled.",
  github_state: "The sign-in could not be verified. Start again from http://localhost:3002/.",
  github_token: "GitHub rejected the authorization code. Check the OAuth callback URL and try again.",
  github_profile: "Orbit could not read your GitHub profile. Try authorizing Orbit again.",
  github_failed: "Orbit could not finish GitHub sign-in. Check that MongoDB is available, then retry.",
  github_link_session: "Your Orbit session expired. Sign in again, then connect GitHub.",
  github_link_conflict: "GitHub says this account is linked to a separate Orbit or Google account. Sign in to that Orbit account, or sign out of github.com and retry if GitHub authorized the wrong profile.",
  google_not_configured: "Google sign-in is not configured yet. Add Google OAuth credentials to Orbit’s server environment.",
  google_cancelled: "Google sign-in was cancelled.",
  google_state: "That Google sign-in attempt was interrupted or expired. Start again from this page.",
  google_token: "Google rejected the authorization code. Check Orbit’s OAuth callback URL and try again.",
  google_profile: "Orbit could not verify your Google profile. Try authorizing Orbit again.",
  google_link_conflict: "This Google identity is already linked to another Orbit account. Sign in to that Orbit account, then connect GitHub there if needed.",
  google_failed: "Orbit could not finish Google sign-in. Check that MongoDB is available, then retry.",
};

export default function SignIn() {
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<AuthHealth | null>(null);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("authError");
    if (code) window.history.replaceState({}, "", window.location.pathname);
    fetch("/api/health").then((response) => response.json()).then((result: AuthHealth) => {
      setHealth(result);
      const googleUnavailable = result.services?.googleOAuth?.status !== "ready";
      if (code && !(code.startsWith("google_") && googleUnavailable)) {
        setError(authErrors[code] ?? "Sign-in could not be completed. Please try again.");
      }
    }).catch(() => {
      setHealth(null);
      if (code && !code.startsWith("google_")) setError(authErrors[code] ?? "Sign-in could not be completed. Please try again.");
    });
  }, []);

  const accountStore = health?.services?.accountStore;
  const googleOAuth = health?.services?.googleOAuth;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          username: form.get("username"),
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not sign in.");
      window.location.assign("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-art">
        <div className="brand brand-light"><span className="brand-symbol">◈</span>orbit<span className="brand-dot">.</span></div>
        <div className="art-content">
          <div className="eyebrow light">YOUR CODEBASE, IN CONTEXT</div>
          <h1>See the work<br />behind the code.</h1>
          <p>Connect GitHub to explore repositories, understand contribution patterns, and spot what needs attention across your projects.</p>
          <div className="art-orbit art-orbit-a" />
          <div className="art-orbit art-orbit-b" />
          <div className="art-stars">✳ <span>⌘</span> · ⌁ · ◉</div>
        </div>
        <div className="login-art-foot">ORBIT&nbsp; · &nbsp;REPOSITORY INTELLIGENCE</div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="login-glyph">◈</div>
          <div className="eyebrow">WELCOME TO ORBIT</div>
          <h2>{mode === "login" ? "Sign in to Orbit" : "Create your Orbit account"}</h2>
          <p className="muted">Sign in with GitHub, or use an Orbit account and connect GitHub afterward.</p>

          <a className="github-login-primary" href="/api/auth/github?mode=login">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.53v-2.07c-3.1.67-3.75-1.32-3.75-1.32-.5-1.28-1.24-1.62-1.24-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.7 1.15 1.7 1.15.99 1.7 2.6 1.21 3.23.92.1-.72.39-1.21.7-1.49-2.48-.28-5.08-1.24-5.08-5.52 0-1.22.43-2.22 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.05 1.14a10.6 10.6 0 0 1 5.55 0c2.12-1.44 3.05-1.14 3.05-1.14.61 1.54.23 2.68.12 2.96.71.78 1.14 1.78 1.14 3.01 0 4.29-2.6 5.23-5.09 5.5.4.35.75 1.03.75 2.08V22c0 .29.2.64.77.53A11.1 11.1 0 0 0 12 .9Z" />
            </svg>
            Continue with GitHub
          </a>
          <p className="github-login-note">GitHub signs you in with the account currently authorized at github.com. To use another account, switch GitHub accounts before continuing.</p>
          <div className="login-divider"><span>or use an Orbit account</span></div>
          <div className="login-tabs" role="tablist" aria-label="Orbit account access">
            <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "selected" : ""} onClick={() => { setMode("login"); setError(""); }}>Sign in</button>
            <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "selected" : ""} onClick={() => { setMode("register"); setError(""); }}>Create account</button>
          </div>

          <form className="credentials-form" onSubmit={submit}>
            <label>Username<input name="username" type="text" autoComplete="username" minLength={3} maxLength={32} placeholder="Your Orbit username" required /></label>
            {mode === "register" && <label>Email<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required /></label>}
            <label>Password<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={10} maxLength={256} placeholder={mode === "login" ? "Your password" : "At least 10 characters"} required /></label>
            <button className="primary-button full credential-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
          </form>

          <div className="login-divider"><span>or continue with</span></div>
          {googleOAuth?.status === "ready" ? (
            <a className="google-login-button" href="/api/auth/google">
              <svg aria-hidden="true" viewBox="0 0 48 48" width="19" height="19"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.9 6.1-15Z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.1c-1.8 1.2-4 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.5H5.8v5.3A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.6 27.4a12 12 0 0 1 0-6.8v-5.3H5.8a20 20 0 0 0 0 17.4l6.8-5.3Z"/><path fill="#EA4335" d="M24 12.1c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 6.1 29.5 4 24 4A20 20 0 0 0 5.8 15.3l6.8 5.3C14.2 15.7 18.7 12.1 24 12.1Z"/></svg>
              Continue with Google
            </a>
          ) : (
            <button className="google-login-button unavailable" type="button" disabled>
              <svg aria-hidden="true" viewBox="0 0 48 48" width="19" height="19"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.9 6.1-15Z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.1c-1.8 1.2-4 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.5H5.8v5.3A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.6 27.4a12 12 0 0 1 0-6.8v-5.3H5.8a20 20 0 0 0 0 17.4l6.8-5.3Z"/><path fill="#EA4335" d="M24 12.1c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 6.1 29.5 4 24 4A20 20 0 0 0 5.8 15.3l6.8 5.3C14.2 15.7 18.7 12.1 24 12.1Z"/></svg>
              Continue with Google
            </button>
          )}
          <p className="github-login-note">Google signs you into Orbit. Connect GitHub afterward to authorize repository access.</p>
          {googleOAuth?.status !== "ready" && <p className="google-setup-note" role="status">Google sign-in isn’t configured on this Orbit server yet.</p>}

          {error && <div className="form-error" role="alert" style={{ marginTop: 14 }}>{error}</div>}
          {accountStore && accountStore.status !== "ready" && <aside className="setup-note" role="status"><strong>Orbit account storage is unavailable</strong><p>{accountStore.message}</p></aside>}
          <p className="demo-hint" style={{ lineHeight: 1.7 }}>After signing in, choose <b>Connect GitHub</b> in your workspace to authorize your own account. Orbit never asks for or stores your GitHub password.</p>
          <div className="login-bottom">A clearer view of your developer ecosystem <span>✳</span></div>
        </div>
      </section>
    </main>
  );
}
