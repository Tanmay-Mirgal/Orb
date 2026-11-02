/** Landing-page copy that is also published as structured data (FAQ rich results, video object). */

export const FAQ: Array<[string, string]> = [
  ["What can I deploy?", "Static sites (Vite, React, Astro, Docusaurus, plain HTML), SSR apps (Next.js, Nuxt, Remix), backend services (Node, Python, Go) and anything with a Dockerfile. You can also run background workers and cron jobs."],
  ["Is the Hobby plan really free?", "Yes, forever, with no card. You get 5 projects, custom domains with HTTPS and up to 2 web service / worker / cron projects. Free web services go to sleep after 20 idle minutes and wake on the next request; static sites are always on."],
  ["Is Orb a Vercel or Render alternative?", "Orb covers the same core workflow — Git-driven deploys, preview deployments, rollbacks, custom domains, environment variables, logs, analytics and teams — and you can run it on your own server. It is a smaller platform: there is no global multi-region CDN or managed database yet."],
  ["How do custom domains work?", "Add your domain in the project and create the CNAME (or an A record for apex domains) that Orb shows you. Pointing DNS at Orb proves ownership, and HTTPS is provisioned automatically."],
  ["How do teams and invitations work?", "Create a team, enter a teammate's e-mail and pick a role. They get a link by e-mail, sign in with the GitHub account that uses that address and accept. Teams need a paid plan to have more than one member."],
  ["How do I pay, and does it renew automatically?", "Payments run through Razorpay (UPI, cards, netbanking). A plan is prepaid for a month or a year and never renews on its own; we e-mail you 7, 3 and 1 days before it ends, and renewing early simply adds time."],
  ["What alerts will I get?", "A deployment finished or failed, a custom domain went live or lost its DNS, a service lost an instance, a teammate joined, a payment was received and a plan is ending. Each shows in the dashboard bell; you choose which categories are also e-mailed."],
  ["Is there downtime when I deploy?", "No. A new release only receives traffic after its instances pass health checks. If something fails, the previous deployment keeps serving."],
  ["How are my secrets protected?", "Environment variables are encrypted at rest, bound to their project, masked in build logs and — when marked sensitive — never returned by the API."],
  ["Can I self-host Orb?", "Yes. Orb is built to run on your own infrastructure — a single server to start, then add worker and runner machines as you grow."],
];

export const TRANSCRIPT = [
  "From git push to production in seconds.",
  "Pick a GitHub repo. Orb detects the framework, builds it and goes live.",
  "Static sites, web services, background workers and cron jobs.",
  "Releases only get traffic when healthy. Roll back in one click.",
  "Bring your own domain. HTTPS is issued and renewed automatically.",
  "Encrypted environment variables. Live logs. Request analytics.",
  "Invite teammates by e-mail: owner, admin, member or viewer.",
  "Alerts in your dashboard and your inbox: deploys, domains, billing.",
  "Free services sleep after 20 minutes and wake on the next request.",
  "Hobby is free. Upgrade with Razorpay: UPI, cards or netbanking.",
  "Orb. Deploy anything. Scale without servers.",
];

export const TOUR_VIDEO = {
  name: "Orb in 55 seconds: deploy, roll back, add domains, invite a team",
  description: "A captioned product tour of Orb: git-driven deploys, project types, rollbacks, custom domains with HTTPS, encrypted secrets, logs and analytics, teams, alerts, scale-to-zero and plans.",
  uploadDate: "2026-11-02",
  durationIso: "PT55S",
  src: "/media/orb-tour.mp4",
  poster: "/media/orb-tour-poster.jpg",
};
