import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SessionAuthorizationProvider } from "@/shared/session/session-authorization";
import "./globals.css";
import { AuthGate, AppToolbar, ImpersonationBanner, MobileDrawer, PrintableProvider, WorkflowShell } from "@/shared/shell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Bill n Chill",
    template: "%s | Bill n Chill",
  },
  description: "Bill n Chill operations workspace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <SessionAuthorizationProvider>
          <PrintableProvider>
            <AppToolbar />
            <ImpersonationBanner />
            <MobileDrawer />
            <WorkflowShell />
            <AuthGate>{children}</AuthGate>
          </PrintableProvider>
        </SessionAuthorizationProvider>
      </body>
    </html>
  );
}
