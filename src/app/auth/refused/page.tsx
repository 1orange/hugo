import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AuthRefusedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Access refused</CardTitle>
          <CardDescription>
            Your Google account is not on the allowlist for this application.
            Contact the administrator if you believe this is a mistake.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted"
            href="/sign-in"
          >
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
