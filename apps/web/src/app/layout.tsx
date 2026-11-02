import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { ThemeProvider, type ThemeChoice } from "@/components/app/theme";
import { THEME_COOKIE } from "@/lib/theme-cookie";
import { AUTHOR, HOME_DESCRIPTION, KEYWORDS, SITE_NAME, SITE_URL, SOCIAL_TITLE } from "@/lib/site";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Orb — Deploy anything. Scale without servers.", template: "%s · Orb" },
  description: HOME_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: KEYWORDS,
  authors: [AUTHOR],
  creator: AUTHOR.name,
  publisher: SITE_NAME,
  category: "technology",
  alternates: { canonical: "/" },
  formatDetection: { telephone: false, email: false, address: false },
  // Pages inherit this; the app and login override it with noindex.
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    locale: "en_IN",
    title: SOCIAL_TITLE,
    description: HOME_DESCRIPTION,
    // The image comes from app/opengraph-image.tsx.
  },
  twitter: { card: "summary_large_image", title: SOCIAL_TITLE, description: HOME_DESCRIPTION },
  // Search Console / Bing Webmaster ownership tags (optional; set the env vars, no rebuild of code needed).
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION } : undefined,
  },
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
