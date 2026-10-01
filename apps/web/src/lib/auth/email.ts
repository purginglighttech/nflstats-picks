/**
 * Email delivery abstraction.
 *
 * Server-only.
 *
 * Phase 1 ships a dev-outbox sender: verification/reset links are written to
 * `<apps/web>/.dev-outbox/` (gitignored) and printed to the console in
 * development. A real provider plugs in later by implementing `EmailSender`
 * (see README.md) — route handlers depend only on the interface.
 *
 * Never log the recipient's email body contents beyond the outbox file and
 * the dev console; never log tokens outside the link itself.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export interface VerificationEmail {
  to: string;
  verifyUrl: string;
}

export interface PasswordResetEmail {
  to: string;
  resetUrl: string;
}

export interface EmailSender {
  sendVerificationEmail(email: VerificationEmail): Promise<void>;
  sendPasswordResetEmail(email: PasswordResetEmail): Promise<void>;
}

function outboxDir(): string {
  return path.join(process.cwd(), ".dev-outbox");
}

function fileKey(prefix: string, to: string): string {
  const digest = createHash("sha256").update(to.toLowerCase()).digest("hex").slice(0, 12);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${stamp}-${digest}.txt`;
}

async function writeOutbox(kind: "verify" | "reset", to: string, url: string): Promise<void> {
  const dir = outboxDir();
  await mkdir(dir, { recursive: true });
  const body = [
    `kind: ${kind}`,
    `to: ${to}`,
    `at: ${new Date().toISOString()}`,
    ``,
    url,
    ``,
  ].join("\n");
  await writeFile(path.join(dir, fileKey(kind, to)), body, "utf8");
}

/**
 * Phase-1 sender. In development it writes the link to `.dev-outbox/` and
 * echoes it to the console. In production no mail provider is wired yet, and
 * the container runs as a non-root user that cannot write an outbox to disk —
 * so instead of crashing on the filesystem write, it logs the link for the
 * staging operator to complete verification from the app logs. This is a
 * stopgap until a real provider implements `EmailSender`; it must not be
 * treated as delivered mail.
 */
export class DevOutboxEmailSender implements EmailSender {
  async sendVerificationEmail({ to, verifyUrl }: VerificationEmail): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      console.log(
        `[email-staging] NO MAIL PROVIDER — verification link for ${to}: ${verifyUrl}`,
      );
      return;
    }
    await writeOutbox("verify", to, verifyUrl);
    console.log(`[dev-outbox] verification link for ${to}: ${verifyUrl}`);
  }

  async sendPasswordResetEmail({ to, resetUrl }: PasswordResetEmail): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      console.log(
        `[email-staging] NO MAIL PROVIDER — password-reset link for ${to}: ${resetUrl}`,
      );
      return;
    }
    await writeOutbox("reset", to, resetUrl);
    console.log(`[dev-outbox] password-reset link for ${to}: ${resetUrl}`);
  }
}

let sender: EmailSender | undefined;

/**
 * Resolve the configured sender. Phase 1 always returns the dev outbox;
 * replace the selection logic here (env-driven) when the SMTP provider
 * lands — no route changes needed.
 */
export function getEmailSender(): EmailSender {
  sender ??= new DevOutboxEmailSender();
  return sender;
}

/** Build an absolute URL for an auth link from APP_URL (fallback: localhost dev). */
export function absoluteUrl(pathname: string): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return new URL(pathname, base).toString();
}
