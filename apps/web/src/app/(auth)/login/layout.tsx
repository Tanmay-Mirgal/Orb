import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Log in",
  description: "Sign in to Orb with GitHub to deploy and manage your projects.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/login" },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
