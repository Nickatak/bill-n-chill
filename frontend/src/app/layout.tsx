import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SessionAuthorizationProvider } from "@/shared/session/session-authorization";
import { ServiceWorkerRegistration } from "@/shared/pwa";
import "./globals.css";
import { AuthGate, AppToolbar, ImpersonationBanner, MobileBottomNav, PrintableProvider, WorkflowShell } from "@/shared/shell";

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
  description: "Construction billing and payment management",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Bill n Chill",
  },
  icons: {
    icon: "/favicon.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#374b6e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <ServiceWorkerRegistration />
        <SessionAuthorizationProvider>
          <PrintableProvider>
            <AppToolbar />
            <ImpersonationBanner />

            <WorkflowShell />
            <AuthGate>{children}</AuthGate>
            <MobileBottomNav />
          </PrintableProvider>
        </SessionAuthorizationProvider>
      </body>
    </html>
  );
}
