import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { previewInvitation } from "@/server/services/invitations";
import { InviteClient } from "@/features/team/InviteClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team invitation", robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  const invite = await previewInvitation(token, session.user.email);
  return <InviteClient token={token} invite={JSON.parse(JSON.stringify(invite))} viewerEmail={session.user.email} />;
}
