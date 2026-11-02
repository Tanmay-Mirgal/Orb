# SEO — Orb ko Google par kaise dhoondha jaaye

Site: **https://orb.tanmaymirgal.dev**. Technical SEO code me ho chuka hai; neeche wo hai jo tumhe deploy ke baad **ek baar** karna hai (code se ye nahi ho sakta).

## 1. Code me kya hai (apne aap)

| Cheez | Kahan | Kyun |
|---|---|---|
| Title + description (≤ 60 / ≤ 165 chars), canonical URL, keywords | `apps/web/src/lib/site.ts`, `app/layout.tsx`, `app/page.tsx` | Search result me jo dikhta hai. Copy yahin se badlo. |
| **Open Graph + Twitter card image** (1200×630) | `app/opengraph-image.tsx`, `app/twitter-image.tsx` (design: `lib/og.tsx`) | WhatsApp / LinkedIn / Slack / X par link share karne par preview. Live URL: `/opengraph-image` |
| Structured data (JSON-LD): Organization, WebSite, SoftwareApplication (plans ₹0 / ₹999 / ₹4,999), VideoObject, FAQPage | `lib/seo.ts` | Google ko page ka matlab saaf batata hai. |
| `robots.txt`, `sitemap.xml` (page + image + video) | `app/robots.ts`, `app/sitemap.ts` | Crawlers ko batata hai kya dekhna hai. `/dashboard`, `/api`, `/invite` band; `/login` crawlable par `noindex`. |
| Web manifest + icons (192/512, apple-touch) | `app/manifest.ts`, `public/icon-*.png`, `app/apple-icon.png` | Mobile "Add to home screen", favicon quality. |
| `llms.txt` | `public/llms.txt` | AI assistants ke liye short summary. |
| Dashboard / login / invite pages `noindex` | layouts | Private pages search me na aayein. |
| Video poster + `preload="none"` | `LandingClient.tsx` | Page fast rehta hai (Core Web Vitals = ranking signal). |

Localhost kabhi canonical/sitemap me nahi jaata: `NEXT_PUBLIC_APP_URL` localhost ho to production URL use hota hai.

## 2. Deploy ke baad — tumhara kaam (30 minute)

1. **Google Search Console** → *Add property* → **Domain** `tanmaymirgal.dev` → Google ek TXT record deta hai → DNS me add karo (Cloudflare/jahan DNS hai). (URL-prefix method chahiye to HTML tag milega; uski value `.env` me `GOOGLE_SITE_VERIFICATION=` me daalo aur redeploy.)
2. Search Console → *Sitemaps* → `https://orb.tanmaymirgal.dev/sitemap.xml` submit.
3. *URL inspection* → `https://orb.tanmaymirgal.dev/` → **Request indexing**.
4. **Bing Webmaster Tools** → "Import from Google Search Console" (ya `BING_SITE_VERIFICATION=` env).
5. Preview check karo (cache saaf karwane ke liye ye tools use karo):
   - Facebook Sharing Debugger → URL daalo → *Scrape again*
   - LinkedIn Post Inspector
   - WhatsApp: link khud ko bhejke dekho
   - [Rich Results Test](https://search.google.com/test/rich-results) → JSON-LD valid hai ya nahi
   - Lighthouse (Chrome DevTools) → SEO / Performance score

## 3. Ranking kaise badhegi (honest baat)

Technical SEO sirf *entry ticket* hai. "Orb" bahut generic naam hai, to sabse pehle brand search (`Orb tanmaymirgal`) aur long-tail phrases par aaoge: *"deploy nextjs from github free"*, *"vercel alternative self hosted"*, *"cron job hosting india"*. Asli asar **backlinks** se aata hai:

- Apne portfolio `tanmaymirgal.dev`, GitHub profile aur repo description me `https://orb.tanmaymirgal.dev` ka link (sabse sasta, sabse zaroori).
- Tour video (`/media/orb-tour.mp4`) ke saath LinkedIn / X post; Show HN, Product Hunt, r/selfhosted, dev.to article.
- AlternativeTo, Slant jaisi directories par "Vercel / Render alternative" listing.
- Result aane me aam taur par kuch hafte lagte hain; Search Console me *Performance* tab se dekhte raho kaunsi queries aa rahi hain.

## 4. Ek cheez jo baad me sochni hai
Customers ke apps `<project>.orb.tanmaymirgal.dev` par chalte hain, yaani tumhare domain ke subdomains. Spam/phishing wale projects domain ki reputation kharab kar sakte hain. Jab user base badhe to free plan ke apps par `X-Robots-Tag: noindex` aur abuse reporting par vichar karna.
