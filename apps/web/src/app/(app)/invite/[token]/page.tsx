import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { INVITE_TOKEN_PATTERN } from "@/features/team/constants/team";
import { INVITE_COPY } from "@/features/team/constants/team-copy";
import { InviteScreen } from "@/screens/invite/invite-screen";

// In the (app) group for Privy, outside /app: the invited user may have no account yet. The token is a secret link.
export const metadata: Metadata = { title: INVITE_COPY.pageTitle };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  if (!INVITE_TOKEN_PATTERN.test(token)) notFound();
  return <InviteScreen token={token} />;
}
