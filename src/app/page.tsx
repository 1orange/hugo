import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";

export default async function HomePage() {
  const session = await auth();
  const allowlist = loadAllowlistFromEnv();

  if (
    session?.user?.email &&
    isEmailAllowed(session.user.email, allowlist)
  ) {
    redirect("/companies");
  }

  redirect("/sign-in");
}
