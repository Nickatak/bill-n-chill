import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SessionAuthorizationProvider } from "@/features/session/session-authorization";
import "./globals.css";
import { AuthGate } from "./auth-gate";
import { ThemeToggle } from "./theme-toggle";
import { WorkflowShell } from "./workflow-shell";

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
    // NOTE: default theme is intentionally dark for MVP demos.
    // Revert later by changing this data-theme and the fallback below from "dark" to "light".
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                var key = 'bnc-theme';
                var fallback = 'dark';
                try {
                  var stored = window.localStorage.getItem(key);
                  var theme = (stored === 'dark' || stored === 'light') ? stored : fallback;
                  document.documentElement.setAttribute('data-theme', theme);
                } catch (e) {
                  document.documentElement.setAttribute('data-theme', fallback);
                }
              })();
            `,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <SessionAuthorizationProvider>
          <ThemeToggle />
          <WorkflowShell />
          <AuthGate>{children}</AuthGate>
        </SessionAuthorizationProvider>
      </body>
    </html>
  );
}
