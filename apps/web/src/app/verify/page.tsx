import { AuthCard, VerifyEmail } from "@/components/auth/auth-forms";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

/** /verify — consumes the token from the email link; shows success/expired. */
export default async function VerifyPage({ searchParams }: PageProps): Promise<React.JSX.Element> {
  const { token } = await searchParams;
  return (
    <AuthCard title="Verify your email">
      <VerifyEmail token={token ?? null} />
    </AuthCard>
  );
}
