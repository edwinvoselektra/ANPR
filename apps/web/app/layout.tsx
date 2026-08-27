import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = { title: "ANPR Platform", description: "ANPR-platform voor buurtpreventie" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="nl"><body><AppShell>{children}</AppShell></body></html>;
}
