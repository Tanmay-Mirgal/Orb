import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { ThemeProvider, type ThemeChoice } from "@/components/app/theme";
import { THEME_COOKIE } from "@/lib/theme-cookie";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Orb — Deploy anything. Scale without servers.", template: "%s · Orb" },
  description:
    "Orb is the deployment platform for static sites, web services, background workers and cron jobs. Git push to live in seconds, with custom domains, automatic HTTPS and instant rollbacks.",
  applicationName: "Orb",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#08080a" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const stored = (await cookies()).get(THEME_COOKIE)?.value;
  const theme: ThemeChoice = stored === "light" || stored === "dark" ? stored : "system";
  return (
    <html lang="en" className={theme === "system" ? undefined : theme}>
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-screen font-sans antialiased`}>
        <ThemeProvider initial={theme}>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
