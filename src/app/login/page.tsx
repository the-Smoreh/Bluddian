import { redirect } from 'next/navigation';
import { needsSetup } from '@/lib/auth';
import { AuthForm } from '@/components/AuthForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // First run has no owner yet — send them to claim the dashboard instead.
  if (needsSetup()) redirect('/setup');

  return <AuthForm mode="login" requiresSetupCode={false} />;
}
