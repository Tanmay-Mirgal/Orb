import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Check, ShieldCheck, TriangleAlert } from "lucide-react";
import { connectorConfig, connectorEnabled } from "core";
import { scopeDefinition } from "shared";
import { auth } from "@/lib/auth";
import { listMemberships } from "@/server/orgs";
import { consentOptions, redirectWith, validateAuthorizeRequest } from "@/server/connector/oauth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/app/page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect an app", robots: { index: false, follow: false } };

type Search = Record<string, string | string[] | undefined>;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10">
      <Logo />
      <div className="w-full max-w-lg">{children}</div>
    </main>
  );
}

const roleLabel = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);

/**
 * Consent screen of the ecosystem connector. The OAuth request is validated before anything else: an unknown client or
 * return address is shown as an error here and never redirected to. Everything posted back is validated again.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Search> }) {
  if (!connectorEnabled()) notFound();

  const raw = await searchParams;
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single !== undefined) params[key] = single;
  }

  const validation = validateAuthorizeRequest(params);
  if (!validation.ok) {
    if (validation.display === "redirect") {
      redirect(redirectWith(validation.redirectUri, { error: validation.error, error_description: validation.description, state: validation.state }));
    }
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TriangleAlert className="size-4 text-warning" /> This request can&apos;t be completed</CardTitle>
            <CardDescription>{validation.message}</CardDescription>
          </CardHeader>
          <CardContent className="text-[13px] text-muted-foreground">Nothing was shared. Go back to the app you came from and start again, or contact its owner.</CardContent>
        </Card>
      </Shell>
    );
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect(`/login?next=${encodeURIComponent(`/connect/authorize?${new URLSearchParams(params).toString()}`)}`);

  const { hubName } = connectorConfig();
  const { request } = validation;
  const options = consentOptions(await listMemberships(session.user.id), request.scopes);

  return (
    <Shell>
      <form method="post" action="/connect/authorize/decision">
        {Object.entries(params).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck className="size-5 text-accent" /> {hubName} wants to connect to your Orb account</CardTitle>
            <CardDescription>
              Signed in as <span className="font-medium text-foreground">{session.user.email}</span>. {hubName} will act as you, inside one team of your choice, and never with more access than your role in that team.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            <section aria-labelledby="scopes-title">
              <h2 id="scopes-title" className="mb-2 text-[13px] font-medium">{hubName} is asking to:</h2>
              <ul className="space-y-1.5">
                {request.scopes.map((scope) => (
                  <li key={scope} className="flex items-start gap-2 text-[13px]">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                    <span>{scopeDefinition(scope).consent}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="team-title">
              <h2 id="team-title" className="mb-2 text-[13px] font-medium">Connect this team</h2>
              {options.length === 0 ? (
                <p role="alert" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-[13px]">
                  None of your teams lets you grant this access. Ask an admin of the team to connect it, or ask {hubName} to request fewer permissions.
                </p>
              ) : (
                <fieldset className="space-y-2">
                  <legend className="sr-only">Team</legend>
                  {options.map((option, index) => (
                    <label key={option.org.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-secondary has-[:checked]:border-accent has-[:checked]:ring-2 has-[:checked]:ring-accent/25">
                      <input type="radio" name="org_id" value={option.org.id} defaultChecked={index === 0} required className="mt-1 size-4" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium">{option.org.name}</span>
                          <Badge variant="outline">{roleLabel(option.role)}</Badge>
                        </span>
                        {option.withheld.length > 0 ? (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            Not available with your {option.role} role: {option.withheld.map((s) => scopeDefinition(s).consent.toLowerCase()).join("; ")}.
                          </span>
                        ) : (
                          <span className="mt-1 block text-xs text-muted-foreground">Everything requested is available.</span>
                        )}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
            </section>
          </CardContent>

          <CardFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">Disconnect any time in Settings → Connected apps.</p>
            <div className="flex justify-end gap-2">
              <Button type="submit" name="decision" value="deny" variant="outline" formNoValidate>Cancel</Button>
              <Button type="submit" name="decision" value="allow" variant="accent" disabled={options.length === 0}>Allow</Button>
            </div>
          </CardFooter>
        </Card>
      </form>
    </Shell>
  );
}
