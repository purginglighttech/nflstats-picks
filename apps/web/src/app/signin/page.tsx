import { AuthCard, SigninForm } from "@/components/auth/auth-forms";

interface PageProps {
  searchParams: Promise<{ next?: string; signed_out?: string }>;
}

/** /signin — supports ?next= (same-origin path only; validated client-side). */
export default async function SigninPage({ searchParams }: PageProps): Promise<React.JSX.Element> {
  const { next, signed_out } = await searchParams;
  return (
    <AuthCard title="Sign in">
      {signed_out === "1" && (
        <p role="status" style={{ color: "#0a5c00", fontWeight: 600 }}>
          You have been signed out.
        </p>
      )}
      <SigninForm next={next ?? null} />
    </AuthCard>
  );
}
