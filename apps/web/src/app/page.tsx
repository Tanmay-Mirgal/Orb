import type { Metadata } from "next";
import { LandingClient } from "@/features/landing/components/LandingClient";
import { homeJsonLd, serializeJsonLd } from "@/lib/seo";
import { HOME_DESCRIPTION, HOME_TITLE } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  alternates: { canonical: "/" },
};

export default function LandingPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(homeJsonLd()) }} />
      <LandingClient />
    </>
  );
}
