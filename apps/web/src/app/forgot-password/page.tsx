import { AuthCard, ForgotPasswordForm } from "@/components/auth/auth-forms";

/** /forgot-password — uniform response; never reveals account existence. */
export default function ForgotPasswordPage(): React.JSX.Element {
  return (
    <AuthCard title="Reset your password">
      <ForgotPasswordForm />
    </AuthCard>
  );
}
