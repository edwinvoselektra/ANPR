import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { PwaRegistration } from "@/components/pwa-registration";

export const metadata: Metadata = {
  title: "ANPR Platform", description: "ANPR-platform voor buurtpreventie",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" }
};
export const viewport: Viewport = { themeColor: "#0b1628" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="nl"><body><PwaRegistration/><AppShell>{children}</AppShell></body></html>;
}
