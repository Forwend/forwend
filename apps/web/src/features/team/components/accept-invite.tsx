"use client";

import {
  BUTTON_VARIANTS,
  Button,
  buttonClasses,
  DetailList,
  DetailRow,
  Skeleton,
} from "@forwend/ui-web";
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
import { LoadError } from "@/shared/components/load-error";
import { APP_ROUTES } from "@/shared/config/routes";

const NOT_FOUND = 404;

const status = (error: unknown) => (error as { status?: unknown } | undefined)?.status;
const code = (error: unknown) =>
  (error as { data?: { error?: { code?: string } } } | undefined)?.data?.error?.code;

// Its padding matches DetailRow's, so the facts line up with the heading.
const PANEL = "fw-panel w-full max-w-md overflow-hidden";
const SECTION = "flex flex-col gap-3 px-4 py-5 sm:px-5";
const ACTION = "w-full sm:w-auto sm:self-start";

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
      <div className={PANEL}>
        <Heading title={COPY.goneTitle} body={COPY.goneBody} />
        <div className={`${SECTION} pt-0`}>
          <Link href={APP_ROUTES.home} className={`${buttonClasses()} ${ACTION}`}>
            {COPY.openApp}
          </Link>
        </div>
      </div>
    );
  }
  if (me.isError || invitation.isError) {
    return (
      <div className="w-full max-w-md">
        <LoadError
          message={COPY.loadFailed}
          retrying={me.isFetching || invitation.isFetching}
          onRetry={() => void (me.isError ? me.refetch() : invitation.refetch())}
        />
      </div>
    );
  }
  const invite = invitation.currentData;
  if (!invite) return <InviteSkeleton label={COPY.loading} />;
  const otherEmail = email !== invite.email || code(accepting.error) === TEAM_ERRORS.otherEmail;
  return (
    <div className={PANEL}>
      <Heading
        title={COPY.title(invite.profileName)}
        body={COPY.body(invite.profileName, ROLE_LABELS[invite.role])}
      />
      <DetailList className="border-y border-line">
        <DetailRow term={COPY.role}>{ROLE_LABELS[invite.role]}</DetailRow>
        <DetailRow term={COPY.sentTo}>{invite.email}</DetailRow>
        {email ? <DetailRow term={COPY.signedInAs}>{email}</DetailRow> : null}
        <DetailRow term={COPY.expires}>{formatExpiry(invite.expiresAt)}</DetailRow>
      </DetailList>
      <div className={SECTION}>
        {otherEmail ? (
          <>
            <p role="alert" className="text-sm text-danger">
              {COPY.otherEmail(invite.email)}
            </p>
            <Button
              variant={BUTTON_VARIANTS.secondary}
              onClick={() => void logout()}
              className={ACTION}
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
              className={ACTION}
            >
              {COPY.accept}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function Heading({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2 px-4 pt-6 pb-5 sm:px-5">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      <p className="text-sm text-muted">{body}</p>
    </div>
  );
}

/** The invite panel before it can say anything: while sign-in is checked and while the invite loads. */
export function InviteSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className={PANEL}>
      <span className="sr-only">{label}</span>
      <div aria-hidden className="flex flex-col gap-3 px-4 pt-6 pb-5 sm:px-5">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <div aria-hidden className="flex flex-col gap-4 border-y border-line px-4 py-4 sm:px-5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="flex justify-between gap-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-36" />
          </span>
        ))}
      </div>
      <div aria-hidden className={SECTION}>
        <Skeleton className={`h-10 ${ACTION} sm:w-32`} />
      </div>
    </div>
  );
}
