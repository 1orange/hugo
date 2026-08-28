import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type AuthErrorPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function AuthErrorPage({ searchParams }: AuthErrorPageProps) {
  const { error } = await searchParams;

  if (error === "AccessDenied") {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access refused</CardTitle>
            <CardDescription>
              Your Google account is not on the allowlist for this application.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              className="text-sm font-medium underline"
              href="/sign-in"
            >
              Back to sign in
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign-in error</CardTitle>
          <CardDescription>
            Something went wrong during sign-in. Please try again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link className="text-sm font-medium underline" href="/sign-in">
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
