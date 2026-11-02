import { readFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import { SITE_URL } from "./site";

export const OG_SIZE = { width: 1200, height: 630 };

function logoDataUri(): string | null {
  // The card is prerendered at build time (cwd = apps/web), so the file is never needed in the runtime image.
  // The ignore comment keeps Turbopack from tracing the whole project because of the cwd-based path.
  try {
    return `data:image/png;base64,${readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "logo.png")).toString("base64")}`;
  } catch {
    return null; // the card still renders, without the logo
  }
}

const ACCENT = "#6b82ff";
const MUTED = "#a3a3b1";

/** The 1200×630 social card used for Open Graph (Facebook, LinkedIn, WhatsApp, Slack…) and Twitter/X. */
export function renderSocialCard() {
  const logo = logoDataUri();
  const host = SITE_URL.replace(/^https?:\/\//, "");
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "#08080a",
          color: "#f2f2f5",
          fontFamily: "sans-serif",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", right: -160, top: -180, width: 760, height: 760, borderRadius: 760, background: "radial-gradient(circle, rgba(107,130,255,0.40) 0%, rgba(107,130,255,0) 65%)", display: "flex" }} />
        <div style={{ position: "absolute", left: -240, bottom: -300, width: 640, height: 640, borderRadius: 640, background: "radial-gradient(circle, rgba(107,130,255,0.16) 0%, rgba(107,130,255,0) 65%)", display: "flex" }} />

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", width: 820, height: "100%" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} width={64} height={64} style={{ borderRadius: 16, objectFit: "cover" }} alt="" />
            )}
            <div style={{ display: "flex", marginLeft: 18, fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>Orb</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", flexDirection: "column", fontSize: 74, fontWeight: 800, lineHeight: 1.05, letterSpacing: -3 }}>
              <div style={{ display: "flex" }}>
                <span>From&nbsp;</span>
                <span style={{ color: ACCENT }}>git push</span>
              </div>
              <div style={{ display: "flex" }}>to production,</div>
              <div style={{ display: "flex" }}>in seconds.</div>
            </div>
            <div style={{ display: "flex", marginTop: 22, fontSize: 28, color: MUTED }}>Static sites · Web services · Workers · Cron jobs</div>
            <div style={{ display: "flex", marginTop: 24 }}>
              {["Rollbacks", "Custom domains", "Teams & alerts"].map((t) => (
                <div
                  key={t}
                  style={{ display: "flex", flexShrink: 0, marginRight: 12, padding: "9px 22px", borderRadius: 999, border: "2px solid #2a2a33", background: "#101013", fontSize: 24, color: "#d4d4dc", whiteSpace: "nowrap" }}
                >
                  {t}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", fontSize: 26, color: MUTED }}>
            <div style={{ display: "flex", width: 12, height: 12, borderRadius: 12, background: "#31c46f", marginRight: 12 }} />
            {host} · Free Hobby plan
          </div>
        </div>

        {logo && (
          <div style={{ display: "flex", position: "absolute", right: 70, top: 150, width: 330, height: 330, borderRadius: 80, overflow: "hidden", background: "#000", border: "2px solid #2a2a33", boxShadow: "0 30px 90px rgba(107,130,255,0.35)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} width={330} height={330} style={{ objectFit: "cover" }} alt="" />
          </div>
        )}
      </div>
    ),
    { ...OG_SIZE },
  );
}
