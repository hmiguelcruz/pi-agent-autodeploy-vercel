import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pi Agent - AutoDeploy Vercel",
  description: "AutoDeploy Vercel",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
