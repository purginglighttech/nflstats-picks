"use client";

/**
 * Client-side auth forms. Each posts JSON to the v1 API and handles the
 * uniform { error: { code, message } } envelope.
 *
 * Redirect targets from ?next= are validated client-side as same-origin
 * paths only (mirrors `safeNextPath` in with-api.ts, which cannot be
 * imported here — that module is server-only).
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* Small safe-next check (client copy; see with-api.ts server version)   */
/* ------------------------------------------------------------------ */

function isSafeNextPath(next: string | null | undefined): next is string {
  if (!next) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return false;
  }
  return (
    decoded.startsWith("/") &&
    !decoded.startsWith("//") &&
    !decoded.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(decoded) &&
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)
  );
}

/* ------------------------------------------------------------------ */
/* Minimal mobile-first styling (inline; sibling D owns the theme)      */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = {
  maxWidth: "26rem",
  margin: "3rem auto",
  padding: "1.5rem",
  border: "1px solid #ccc",
  borderRadius: "0.75rem",
};

const field: React.CSSProperties = { marginBottom: "1rem" };
const labelStyle: React.CSSProperties = {
  display: "block",
  fontWeight: 600,
  marginBottom: "0.35rem",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "0.7rem",
  fontSize: "1rem",
  border: "1px solid #888",
  borderRadius: "0.5rem",
  minHeight: "2.75rem",
};
const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.8rem",
  fontSize: "1.05rem",
  fontWeight: 700,
  border: "none",
  borderRadius: "0.5rem",
  cursor: "pointer",
  minHeight: "3rem",
};
const errorStyle: React.CSSProperties = {
  color: "#a00000",
  fontWeight: 600,
  marginBottom: "1rem",
};
const okStyle: React.CSSProperties = {
  color: "#0a5c00",
  fontWeight: 600,
  marginBottom: "1rem",
};

export function AuthCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <main style={card}>
      <h1 style={{ marginTop: 0, fontSize: "1.4rem" }}>{title}</h1>
      {children}
    </main>
  );
}

async function postJson(path: string, body: unknown): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as
    | { ok: true; message?: string }
    | { error: { code: string; message: string } };
  if ("error" in data) return { ok: false, message: data.error.message };
  return { ok: true, message: data.message };
}

function useRedirectTarget(next: string | null): string {
  return isSafeNextPath(next) ? next : "/picks";
}

/* ------------------------------------------------------------------ */
/* Register                                                             */
/* ------------------------------------------------------------------ */

export function RegisterForm({ next }: { next: string | null }): React.JSX.Element {
  const target = useRedirectTarget(next);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const result = await postJson("/api/v1/auth/register", {
      email: form.get("email"),
      password: form.get("password"),
      display_name: form.get("display_name"),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? "Registration failed.");
      return;
    }
    window.location.href = target;
  }

  return (
    <form onSubmit={onSubmit} noValidate={false}>
      {error && (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      )}
      <div style={field}>
        <label htmlFor="reg-email" style={labelStyle}>
          Email
        </label>
        <input
          id="reg-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          style={inputStyle}
        />
      </div>
      <div style={field}>
        <label htmlFor="reg-name" style={labelStyle}>
          Display name
        </label>
        <input
          id="reg-name"
          name="display_name"
          type="text"
          required
          maxLength={40}
          autoComplete="nickname"
          style={inputStyle}
        />
      </div>
      <div style={field}>
        <label htmlFor="reg-password" style={labelStyle}>
          Password (12+ characters)
        </label>
        <input
          id="reg-password"
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          style={inputStyle}
        />
      </div>
      <button type="submit" disabled={busy} style={buttonStyle}>
        {busy ? "Creating account…" : "Create account"}
      </button>
      <p>
        Already have an account? <a href={isSafeNextPath(next) ? `/signin?next=${encodeURIComponent(next)}` : "/signin"}>Sign in</a>
      </p>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Sign in                                                              */
/* ------------------------------------------------------------------ */

export function SigninForm({ next }: { next: string | null }): React.JSX.Element {
  const target = useRedirectTarget(next);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const result = await postJson("/api/v1/auth/signin", {
      email: form.get("email"),
      password: form.get("password"),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? "Sign-in failed.");
      return;
    }
    window.location.href = target;
  }

  return (
    <form onSubmit={onSubmit}>
      {error && (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      )}
      <div style={field}>
        <label htmlFor="si-email" style={labelStyle}>
          Email
        </label>
        <input
          id="si-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          style={inputStyle}
        />
      </div>
      <div style={field}>
        <label htmlFor="si-password" style={labelStyle}>
          Password
        </label>
        <input
          id="si-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          style={inputStyle}
        />
      </div>
      <button type="submit" disabled={busy} style={buttonStyle}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p>
        <a href="/forgot-password">Forgot your password?</a>
      </p>
      <p>
        New here?{" "}
        <a href={isSafeNextPath(next) ? `/register?next=${encodeURIComponent(next)}` : "/register"}>
          Create an account
        </a>
      </p>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Forgot password                                                      */
/* ------------------------------------------------------------------ */

export function ForgotPasswordForm(): React.JSX.Element {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    await postJson("/api/v1/auth/forgot-password", { email: form.get("email") });
    setBusy(false);
    // Uniform by design: the same message whether or not the email exists.
    setDone(true);
  }

  if (done) {
    return (
      <p role="status" style={okStyle}>
        If an account exists for that email, a reset link is on its way.
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit}>
      <div style={field}>
        <label htmlFor="fp-email" style={labelStyle}>
          Email
        </label>
        <input
          id="fp-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          style={inputStyle}
        />
      </div>
      <button type="submit" disabled={busy} style={buttonStyle}>
        {busy ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Reset password                                                       */
/* ------------------------------------------------------------------ */

export function ResetPasswordForm({ token }: { token: string | null }): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <p role="alert" style={errorStyle}>
        This reset link is missing its token. Request a new one from the{" "}
        <a href="/forgot-password">forgot-password page</a>.
      </p>
    );
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const result = await postJson("/api/v1/auth/reset-password", {
      token,
      new_password: form.get("new_password"),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? "Password reset failed.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <p role="status" style={okStyle}>
        Password updated — you are signed in. <a href="/picks">Make your picks</a>.
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit}>
      {error && (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      )}
      <div style={field}>
        <label htmlFor="rp-password" style={labelStyle}>
          New password (12+ characters)
        </label>
        <input
          id="rp-password"
          name="new_password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          style={inputStyle}
        />
      </div>
      <button type="submit" disabled={busy} style={buttonStyle}>
        {busy ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Verify email                                                         */
/* ------------------------------------------------------------------ */

export function VerifyEmail({ token }: { token: string | null }): React.JSX.Element {
  const [state, setState] = useState<"working" | "ok" | "bad">("working");

  useEffect(() => {
    if (!token) {
      setState("bad");
      return;
    }
    let cancelled = false;
    fetch(`/api/v1/auth/verify?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!cancelled) setState(res.ok ? "ok" : "bad");
      })
      .catch(() => {
        if (!cancelled) setState("bad");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state === "working") return <p role="status">Verifying your email…</p>;
  if (state === "ok") {
    return (
      <p role="status" style={okStyle}>
        Email verified — you are signed in. <a href="/picks">Make your picks</a>.
      </p>
    );
  }
  return (
    <p role="alert" style={errorStyle}>
      This verification link is invalid or has expired. If your email is
      still unverified, registering again with the same email sends a fresh
      link — or <a href="/signin">sign in</a>.
    </p>
  );
}
