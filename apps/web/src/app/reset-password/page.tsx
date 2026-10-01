import { AuthCard, ResetPasswordForm } from "@/components/auth/auth-forms";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

/** /reset-password — consumes the token from the email link. */
export default async function ResetPasswordPage({ searchParams }: PageProps): Promise<React.JSX.Element> {
  const { token } = await searchParams;
  return (
    <AuthCard title="Choose a new password">
      <ResetPasswordForm token={token ?? null} />
    </AuthCard>
  );
}
