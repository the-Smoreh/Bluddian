import { redirect } from 'next/navigation';
import { needsSetup } from '@/lib/auth';
import { AuthForm } from '@/components/AuthForm';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  // Setup closes permanently once an owner exists.
  if (!needsSetup()) redirect('/login');

  return <AuthForm mode="setup" requiresSetupCode={Boolean(process.env.SETUP_CODE)} />;
}
