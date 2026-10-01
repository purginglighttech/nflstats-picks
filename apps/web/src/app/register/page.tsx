import { AuthCard, RegisterForm } from "@/components/auth/auth-forms";

interface PageProps {
  searchParams: Promise<{ next?: string }>;
}

/** /register — supports ?next= (same-origin path only; validated client-side). */
export default async function RegisterPage({ searchParams }: PageProps): Promise<React.JSX.Element> {
  const { next } = await searchParams;
  return (
    <AuthCard title="Create your account">
      <RegisterForm next={next ?? null} />
    </AuthCard>
  );
}
