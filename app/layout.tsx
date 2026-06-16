import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "π Agent Clone",
  description: "A minimal AI coding agent with active safety guardrails.",
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
