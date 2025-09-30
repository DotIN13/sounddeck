// --------------------------------------------------------------------
// file: app/layout.tsx  (wrap with Tailwind stylesheet)
// --------------------------------------------------------------------
import "./globals.css";
import type { Metadata } from "next";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Music Search & Downloader",
  description: "Search, preview, and download songs with proper tags.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={cn("min-h-screen bg-background antialiased")}>
        {children}
      </body>
    </html>
  );
}
