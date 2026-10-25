"use client";

import { BUTTON_VARIANTS, Button, buttonClasses, Spinner } from "@forwend/ui-web";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSignUpQuery } from "@/features/profiles/api/profiles-api";
import { ROLE_LABELS } from "@/features/profiles/constants/profile";
import { saveChosenProfileId } from "@/features/profiles/lib/chosen-profile";
import { useAcceptInviteMutation, useGetInvitationQuery } from "@/features/team/api/team-api";
import { TEAM_ERRORS } from "@/features/team/constants/team";
import { INVITE_COPY as COPY } from "@/features/team/constants/team-copy";
import { formatExpiry } from "@/features/team/lib/team";
import { APP_ROUTES } from "@/shared/config/routes";

const NOT_FOUND = 404;

const status = (error: unknown) => (error as { status?: unknown } | undefined)?.status;
const code = (error: unknown) =>
  (error as { data?: { error?: { code?: string } } } | undefined)?.data?.error?.code;

export interface AcceptInviteProps {
  token: string;
}

// R-139: for a signed-in user. Signing up first (POST /v1/me) makes the account the invite joins.
export function AcceptInvite({ token }: AcceptInviteProps) {
  const { user, logout } = usePrivy();
  const router = useRouter();
  const me = useSignUpQuery();
  const invitation = useGetInvitationQuery(token, { skip: !me.currentData });
  const [accept, accepting] = useAcceptInviteMutation();
  const email = (user?.email?.address ?? user?.google?.email ?? "").toLowerCase();

  const onAccept = async () => {
    try {
      const { profileId } = await accept(token).unwrap();
      // The app opens on the new list, which has the team's profile and the first run marked done.
      await me.refetch();
      if (user) saveChosenProfileId(user.id, profileId);
      router.push(APP_ROUTES.home);
    } catch {
      // Said below.
    }
  };

  const gone = status(invitation.error) === NOT_FOUND || status(accepting.error) === NOT_FOUND;
  if (gone) {
    return (
      <div className="fw-panel flex w-full max-w-md flex-col gap-4 p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{COPY.goneTitle}</h1>
        <p className="text-muted">{COPY.goneBody}</p>
        <Link href={APP_ROUTES.home} className={`${buttonClasses()} self-start`}>
          {COPY.openApp}
        </Link>
      </div>
    );
  }
  if (me.isError || invitation.isError) {
    return (
      <div role="alert" className="flex flex-col items-center gap-4 text-center">
        <p className="text-ink">{COPY.loadFailed}</p>
        <Button
          onClick={() => void (me.isError ? me.refetch() : invitation.refetch())}
          variant={BUTTON_VARIANTS.secondary}
        >
          {COPY.retry}
        </Button>
      </div>
    );
  }
  const invite = invitation.currentData;
  if (!invite) return <Spinner label={COPY.loading} />;
  const otherEmail = email !== invite.email || code(accepting.error) === TEAM_ERRORS.otherEmail;
  return (
    <div className="fw-panel flex w-full max-w-md flex-col gap-4 p-6 sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        {COPY.title(invite.profileName)}
      </h1>
      <p className="text-ink">{COPY.body(invite.profileName, ROLE_LABELS[invite.role])}</p>
      <p className="text-sm text-muted">
        {COPY.expires(formatExpiry(invite.expiresAt))} {email ? COPY.signedInAs(email) : null}
      </p>
      {otherEmail ? (
        <>
          <p role="alert" className="text-sm text-danger">
            {COPY.otherEmail(invite.email)}
          </p>
          <Button
            variant={BUTTON_VARIANTS.secondary}
            onClick={() => void logout()}
            className="self-start"
          >
            {COPY.signOut}
          </Button>
        </>
      ) : (
        <>
          {accepting.isError ? (
            <p role="alert" className="text-sm text-danger">
              {COPY.failed}
            </p>
          ) : null}
          <Button
            loading={accepting.isLoading}
            onClick={() => void onAccept()}
            className="self-start"
          >
            {COPY.accept}
          </Button>
        </>
      )}
    </div>
  );
}
