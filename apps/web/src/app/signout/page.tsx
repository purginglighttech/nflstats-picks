import { AuthCard } from "@/components/auth/auth-forms";

/**
 * /signout — a POST form. The API route revokes the session, clears the
 * cookie, invalidates push devices, and 303-redirects browsers to /signin.
 */
export default function SignoutPage(): React.JSX.Element {
  return (
    <AuthCard title="Sign out">
      <p>Are you sure you want to sign out?</p>
      <form method="post" action="/api/v1/auth/signout">
        <button
          type="submit"
          style={{
            width: "100%",
            padding: "0.8rem",
            fontSize: "1.05rem",
            fontWeight: 700,
            border: "none",
            borderRadius: "0.5rem",
            cursor: "pointer",
            minHeight: "3rem",
          }}
        >
          Sign out
        </button>
      </form>
      <p>
        <a href="/picks">Cancel</a>
      </p>
    </AuthCard>
  );
}
