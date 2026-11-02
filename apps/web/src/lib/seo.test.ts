import { describe, expect, it } from "vitest";
import { FAQ } from "../features/landing/data";
import { homeJsonLd, serializeJsonLd } from "./seo";
import { HOME_DESCRIPTION, HOME_TITLE, SITE_URL } from "./site";

describe("SEO basics", () => {
  it("keeps title and description inside the lengths search results show", () => {
    expect(HOME_TITLE.length).toBeLessThanOrEqual(60);
    expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(165);
    expect(HOME_DESCRIPTION.length).toBeGreaterThan(110);
  });

  it("never publishes a localhost URL", () => {
    expect(SITE_URL).toMatch(/^https:\/\//);
    expect(JSON.stringify(homeJsonLd())).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it("describes the page with the schema.org types Google reads", () => {
    const graph = homeJsonLd()["@graph"];
    const types = graph.map((n) => n["@type"]);
    expect(types).toEqual(["Organization", "WebSite", "SoftwareApplication", "VideoObject", "FAQPage"]);
    const faq = graph.find((n) => n["@type"] === "FAQPage") as { mainEntity: unknown[] };
    expect(faq.mainEntity).toHaveLength(FAQ.length);
    const app = graph.find((n) => n["@type"] === "SoftwareApplication") as { offers: Array<{ price: string; priceCurrency: string }> };
    expect(app.offers.map((o) => o.price)).toEqual(["0", "999", "4999"]);
    expect(new Set(app.offers.map((o) => o.priceCurrency))).toEqual(new Set(["INR"]));
  });

  it("cannot be broken out of its script tag", () => {
    expect(serializeJsonLd({ a: "</script><script>alert(1)</script>" })).not.toContain("</script>");
  });
});
