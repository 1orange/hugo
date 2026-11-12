import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

/*
 * The platform's own typeface (SF on her Mac), not a downloaded one: it ships
 * optical sizing, the full Slovak diacritic set and tabular figures, and costs
 * nothing to load.
 */

export const metadata: Metadata = {
  title: "Hugo",
  description: "Prehľad dokladov klientov",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sk">
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
