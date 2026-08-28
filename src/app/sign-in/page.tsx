import { isTestAuthEnabled } from "@/lib/auth/test-auth";
import { SignInForm } from "./sign-in-form";

type SignInPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { error } = await searchParams;
  const e2eTestAuthEnabled = isTestAuthEnabled();

  return <SignInForm e2eTestAuthEnabled={e2eTestAuthEnabled} error={error} />;
}
