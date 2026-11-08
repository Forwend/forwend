"use client";

import { Button } from "@forwend/ui-web";
import { ArrowLeft, FilePlus2, KeyRound, Link2, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useAddPasskey } from "@/features/auth/hooks/use-add-passkey";
import { PasskeyOnDevice } from "@/features/auth/lib/passkeys";
import { useCompleteOnboardingMutation } from "@/features/onboarding/api/onboarding-api";
import {
  type DetailsField,
  DetailsPreview,
  DetailsStep,
} from "@/features/onboarding/components/details-step";
import { OnboardingFrame } from "@/features/onboarding/components/onboarding-frame";
import { PasskeyLead, PasskeyStep } from "@/features/onboarding/components/passkey-step";
import {
  type ReadyAction,
  ReadyLead,
  ReadyStep,
} from "@/features/onboarding/components/ready-step";
import { TokensStep } from "@/features/onboarding/components/tokens-step";
import { UseStep } from "@/features/onboarding/components/use-step";
import { ONBOARDING_CHOICES, ONBOARDING_STEPS } from "@/features/onboarding/constants/onboarding";
import { FIRST_RUN_COPY as COPY } from "@/features/onboarding/constants/onboarding-copy";
import {
  landingProfile,
  newKinds,
  onboardingSteps,
  takeReturnPage,
} from "@/features/onboarding/lib/onboarding";
import type { OnboardingChoice, ProfileDetails } from "@/features/onboarding/types/onboarding";
import {
  useGetProfileTokensQuery,
  useSaveBillingDetailsMutation,
  useSaveProfileTokensMutation,
} from "@/features/profiles/api/profiles-api";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { billingErrors } from "@/features/profiles/lib/billing-details";
import type { Profile } from "@/features/profiles/types/profile";
import { useLazyListStoresQuery, useSaveStoreMutation } from "@/features/stores/api/stores-api";
import { needsFreshSignIn } from "@/shared/api/fresh-sign-in";
import { assetKey } from "@/shared/components/chains/asset-selection";
import { APP_ROUTES } from "@/shared/config/routes";
import { selectionSummary } from "@/shared/lib/asset-selection";

// On phones Skip shares a row with Back, so it takes Back's outline to read as its pair.
const PHONE_OUTLINE =
  "max-sm:border max-sm:border-line max-sm:bg-surface dark:max-sm:border-line-strong";

type DetailsKind = typeof PROFILE_KINDS.freelancer | typeof PROFILE_KINDS.merchant;

const DETAILS_STEPS = {
  [ONBOARDING_STEPS.freelancerDetails]: PROFILE_KINDS.freelancer,
  [ONBOARDING_STEPS.merchantDetails]: PROFILE_KINDS.merchant,
} as const;

// The rule profile/stores.go origin() applies, so the store save after the profiles exist cannot be refused.
const ORIGIN =
  /^(?<scheme>https?):\/\/(?<host>[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)(?<port>:[0-9]{1,5})?\/?$/;

/** An origin as a store allows it: https, or http on this machine for test mode, and nothing after the host. */
function websiteOrigin(text: string): string | null {
  const groups = ORIGIN.exec(text.trim().toLowerCase())?.groups;
  if (!groups?.scheme || !groups.host) return null;
  const { scheme, host, port = "" } = groups;
  if (scheme === "https") return `https://${host}${port === ":443" ? "" : port}`;
  if (host === "localhost" || host === "127.0.0.1")
    return `http://${host}${port === ":80" ? "" : port}`;
  return null;
}

export interface FirstRunProps {
  /** The user's profiles before the first run. */
  profiles: readonly Profile[];
  /** The sign-in email, the contact email's first value. */
  email: string;
  passkeyLinked: boolean;
  onSignOut: () => void;
  /** Leaves the first run: opens the profile, then the address. */
  onFinish: (profile: Profile, href: string) => void;
}

// R-50: asked once, while /v1/me has no onboardedAt. The answers are kept here until the tokens step, which makes the
// named profiles in one call and then saves each one's billing details, tokens and website through their own APIs.
// A failed save keeps the profiles it made, so trying again finishes the rest instead of asking for new ones.
export function FirstRun({
  profiles: live,
  email,
  passkeyLinked,
  onSignOut,
  onFinish,
}: FirstRunProps) {
  // Fixed from the start: the onboarding call adds the new profiles to the live list, which would hide which are new.
  const [profiles] = useState(live);
  const [complete] = useCompleteOnboardingMutation();
  const [saveBilling] = useSaveBillingDetailsMutation();
  const [saveTokens] = useSaveProfileTokensMutation();
  const [listStores] = useLazyListStoresQuery();
  const [saveStore] = useSaveStoreMutation();
  const addPasskey = useAddPasskey();
  const personal = profiles.find((p) => p.kind === PROFILE_KINDS.personal) ?? profiles[0];
  const tokens = useGetProfileTokensQuery(personal?.profileId ?? "", { skip: !personal });
  // The new profiles start in the personal one's mode (D-120): test mode where no mainnet is on.
  const testnet = !personal?.livemode;

  const [picked, setPicked] = useState<OnboardingChoice[]>([]);
  // Fixed from the start: adding a passkey on its step must not shift the steps after it.
  const [hadPasskey] = useState(passkeyLinked);
  const steps = useMemo(() => onboardingSteps(picked, hadPasskey), [picked, hadPasskey]);
  const [at, setAt] = useState(0);
  const step = steps[at];
  const [details, setDetails] = useState<Record<DetailsKind, ProfileDetails>>({
    [PROFILE_KINDS.freelancer]: { name: "", email, country: "", address: "" },
    [PROFILE_KINDS.merchant]: { name: "", email, country: "", address: "" },
  });
  // The business fields the user typed in; the rest follow the freelancer step's values.
  const [merchantTouched, setMerchantTouched] = useState<ReadonlySet<keyof ProfileDetails>>(
    new Set(),
  );
  // Details steps left with Skip: the profile is still made, unnamed, and its billing details wait for the setup guide.
  const [skipped, setSkipped] = useState<ReadonlySet<DetailsKind>>(new Set());
  const [website, setWebsite] = useState("");
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const selected = chosen ?? new Set((tokens.data ?? []).filter((t) => t.on).map(assetKey));
  const [errors, setErrors] = useState<Partial<Record<DetailsField, string>>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"main" | "skip" | null>(null);
  const [made, setMade] = useState<readonly Profile[] | null>(null);
  const [after, setAfter] = useState<readonly Profile[]>(profiles);

  const next = () => {
    setErrors({});
    setError("");
    setAt((i) => Math.min(i + 1, steps.length - 1));
  };
  const back = () => {
    setErrors({});
    setError("");
    setAt((i) => Math.max(i - 1, 0));
  };
  const showErrors = (shown: Partial<Record<DetailsField, string>>) => {
    flushSync(() => setErrors(shown));
    document.querySelector<HTMLElement>('main [aria-invalid="true"]')?.focus();
  };

  const toggle = (choice: OnboardingChoice) => {
    setError("");
    setPicked((was) => (was.includes(choice) ? was.filter((c) => c !== choice) : [...was, choice]));
  };
  const edit = (kind: DetailsKind) => (field: keyof ProfileDetails, value: string) => {
    setErrors((shown) => ({ ...shown, [field]: undefined }));
    if (kind === PROFILE_KINDS.merchant) setMerchantTouched((was) => new Set(was).add(field));
    setDetails((all) => ({ ...all, [kind]: { ...all[kind], [field]: value } }));
  };
  const changeTokens = (keys: readonly string[], on: boolean) => {
    const nextSet = new Set(selected);
    for (const key of keys) {
      if (on) nextSet.add(key);
      else nextSet.delete(key);
    }
    if (nextSet.size > 0) setChosen(nextSet);
  };

  const skip = async () => {
    setBusy("skip");
    setError("");
    try {
      const me = await complete({ choices: [], names: {} }).unwrap();
      const profile = landingProfile(profiles, me.profiles);
      if (profile) onFinish(profile, takeReturnPage());
    } catch {
      setError(COPY.failed);
      setBusy(null);
    }
  };

  // Makes the profiles once, then saves what each needs; every save is a PUT, so a retry repeats none of them twice.
  const save = async (withTokens: boolean) => {
    let created = made;
    if (!created) {
      const names = Object.fromEntries(
        newKinds(picked)
          .filter((kind) => !skipped.has(kind as DetailsKind))
          .map((kind) => [kind, details[kind as DetailsKind].name.trim()]),
      );
      const me = await complete({ choices: picked, names }).unwrap();
      created = me.profiles.filter((p) => !profiles.some((b) => b.profileId === p.profileId));
      setMade(created);
      setAfter(me.profiles);
    }
    for (const profile of created) {
      if (profile.kind !== PROFILE_KINDS.freelancer && profile.kind !== PROFILE_KINDS.merchant)
        continue;
      if (skipped.has(profile.kind)) continue;
      const typed = details[profile.kind];
      await saveBilling({
        profileId: profile.profileId,
        body: {
          name: typed.name.trim(),
          email: typed.email.trim(),
          country: typed.country,
          address: typed.address.trim(),
          taxId: null,
        },
      }).unwrap();
    }
    if (withTokens && tokens.data) {
      const off = tokens.data
        .filter((t) => !selected.has(assetKey(t)))
        .map(({ chainId, token }) => ({ chainId, token }));
      const targets = [
        ...created,
        ...(picked.includes(ONBOARDING_CHOICES.receiveAndSend) && personal ? [personal] : []),
      ];
      for (const profile of targets)
        await saveTokens({ profileId: profile.profileId, off }).unwrap();
    }
    const merchant = created.find((p) => p.kind === PROFILE_KINDS.merchant);
    const origin = websiteOrigin(website);
    if (merchant && origin && !skipped.has(PROFILE_KINDS.merchant)) {
      const [store] = await listStores(merchant.profileId).unwrap();
      if (store && !store.allowedOrigins.includes(origin)) {
        await saveStore({
          profileId: merchant.profileId,
          storeId: store.storeId,
          body: {
            name: store.name,
            defaultExpiresIn: store.defaultExpiresIn,
            allowedOrigins: [...store.allowedOrigins, origin],
            brandColor: store.brandColor ?? "",
            tokensOff: store.tokensOff,
          },
        }).unwrap();
      }
    }
  };

  const finish = async (withTokens: boolean) => {
    setBusy(withTokens ? "main" : "skip");
    setError("");
    try {
      await save(withTokens);
      next();
    } catch {
      setError(COPY.failed);
    } finally {
      setBusy(null);
    }
  };
  const skipDetails = (kind: DetailsKind) => {
    setSkipped((was) => new Set(was).add(kind));
    next();
  };

  const proceed = async () => {
    if (step === ONBOARDING_STEPS.use) {
      if (picked.length === 0) setError(COPY.use.pickOne);
      else next();
      return;
    }
    if (step === ONBOARDING_STEPS.freelancerDetails || step === ONBOARDING_STEPS.merchantDetails) {
      const kind = DETAILS_STEPS[step];
      const typed = details[kind];
      const shown: Partial<Record<DetailsField, string>> = billingErrors({
        name: typed.name.trim(),
        email: typed.email.trim(),
        country: typed.country,
        address: typed.address.trim(),
        taxId: null,
      });
      if (kind === PROFILE_KINDS.merchant && website.trim() && !websiteOrigin(website)) {
        shown.website = COPY.details.websiteInvalid;
      }
      if (Object.keys(shown).length > 0) return showErrors(shown);
      setSkipped((was) => {
        const now = new Set(was);
        now.delete(kind);
        return now;
      });
      // A second profile starts from the first one's contact details, field by field until the user changes one.
      if (kind === PROFILE_KINDS.freelancer) {
        setDetails((all) => {
          const merchant = { ...all[PROFILE_KINDS.merchant] };
          for (const field of ["email", "country", "address"] as const) {
            if (!merchantTouched.has(field)) merchant[field] = typed[field];
          }
          return { ...all, [PROFILE_KINDS.merchant]: merchant };
        });
      }
      next();
      return;
    }
    if (step === ONBOARDING_STEPS.tokens) {
      // Saving before the list loads would keep defaults the user never saw; the step shows the load or its error.
      if (tokens.data) await finish(true);
      return;
    }
    if (step === ONBOARDING_STEPS.passkey) {
      setBusy("main");
      setError("");
      try {
        await addPasskey();
        next();
      } catch (e) {
        // A confirm the owner gave up isn't a failure.
        if (!needsFreshSignIn(e))
          setError(e instanceof PasskeyOnDevice ? e.message : COPY.passkey.failed);
      } finally {
        setBusy(null);
      }
    }
  };

  const landing = landingProfile(profiles, after) ?? personal;
  const open = (kind: string, href: string) => {
    const profile = after.find((p) => p.kind === kind) ?? landing;
    if (profile) onFinish(profile, href);
  };
  const actions: ReadyAction[] = [
    ...(picked.includes(ONBOARDING_CHOICES.getPaidByClients)
      ? [
          {
            kind: PROFILE_KINDS.freelancer,
            href: APP_ROUTES.newInvoice,
            icon: FilePlus2,
            ...COPY.ready.actions.freelancer,
          },
        ]
      : []),
    ...(picked.includes(ONBOARDING_CHOICES.acceptBusinessPayments)
      ? [
          {
            kind: PROFILE_KINDS.merchant,
            href: APP_ROUTES.newLink,
            icon: Link2,
            ...COPY.ready.actions.merchant,
          },
        ]
      : []),
    ...(picked.includes(ONBOARDING_CHOICES.buildIntegration)
      ? [
          {
            kind: PROFILE_KINDS.merchant,
            href: APP_ROUTES.developers,
            icon: KeyRound,
            ...COPY.ready.actions.developer,
          },
        ]
      : []),
    ...(picked.includes(ONBOARDING_CHOICES.receiveAndSend)
      ? [
          {
            kind: PROFILE_KINDS.personal,
            href: APP_ROUTES.home,
            icon: Wallet,
            ...COPY.ready.actions.personal,
          },
        ]
      : []),
  ];

  // Once the uses have made their profiles they can't change, so Back stops at the step after them.
  const backButton =
    at > 0 && !(made && steps[at - 1] === ONBOARDING_STEPS.use) ? (
      <Button size="lg" variant="secondary" onClick={back} disabled={busy !== null}>
        <ArrowLeft aria-hidden className="size-[var(--fw-icon-sm)]" />
        {COPY.back}
      </Button>
    ) : undefined;
  const continueButton = (
    <Button size="lg" type="submit" loading={busy === "main"} disabled={busy === "skip"}>
      {COPY.continue}
    </Button>
  );
  const skipButton = (onClick: () => void) => (
    <Button
      size="lg"
      variant="ghost"
      className={PHONE_OUTLINE}
      onClick={onClick}
      loading={busy === "skip"}
      disabled={busy === "main"}
    >
      {COPY.skipStep}
    </Button>
  );
  const frame = {
    step: at,
    steps: steps.length,
    onSignOut,
    onSubmit: () => void proceed(),
    error,
  };

  if (step === ONBOARDING_STEPS.freelancerDetails || step === ONBOARDING_STEPS.merchantDetails) {
    const kind = DETAILS_STEPS[step];
    return (
      <OnboardingFrame
        {...frame}
        title={COPY.details[kind].title}
        intro={COPY.details[kind].intro}
        secondary={backButton}
        skip={skipButton(() => skipDetails(kind))}
        primary={continueButton}
        aside={<DetailsPreview kind={kind} value={details[kind]} testnet={testnet} />}
      >
        <DetailsStep
          kind={kind}
          value={details[kind]}
          onChange={edit(kind)}
          website={
            kind === PROFILE_KINDS.merchant && picked.includes(ONBOARDING_CHOICES.buildIntegration)
              ? { value: website, onChange: setWebsite }
              : undefined
          }
          errors={errors}
        />
      </OnboardingFrame>
    );
  }
  if (step === ONBOARDING_STEPS.tokens) {
    return (
      <OnboardingFrame
        {...frame}
        title={COPY.tokens.title}
        intro={COPY.tokens.intro}
        secondary={backButton}
        skip={skipButton(() => void finish(false))}
        primary={continueButton}
      >
        <TokensStep
          options={tokens.data}
          failed={tokens.isError}
          onRetry={() => void tokens.refetch()}
          selected={selected}
          onChange={changeTokens}
          testnet={testnet}
        />
      </OnboardingFrame>
    );
  }
  if (step === ONBOARDING_STEPS.passkey) {
    return (
      <OnboardingFrame
        {...frame}
        title={COPY.passkey.title}
        intro={COPY.passkey.intro}
        lead={<PasskeyLead />}
        centered
        secondary={backButton}
        skip={
          <Button
            size="lg"
            variant="ghost"
            className={PHONE_OUTLINE}
            onClick={next}
            disabled={busy !== null}
          >
            {COPY.passkey.notNow}
          </Button>
        }
        primary={
          <Button size="lg" type="submit" loading={busy === "main"}>
            {COPY.passkey.add}
          </Button>
        }
      >
        <PasskeyStep />
      </OnboardingFrame>
    );
  }
  if (step === ONBOARDING_STEPS.ready) {
    const summary = tokens.data ? selectionSummary(tokens.data, selected) : "";
    return (
      <OnboardingFrame
        {...frame}
        title={COPY.ready.title[landing?.kind ?? PROFILE_KINDS.personal]}
        intro={summary}
        lead={<ReadyLead />}
        centered
        onSubmit={() => landing && onFinish(landing, takeReturnPage())}
        secondary={<p className="text-sm text-muted">{COPY.ready.later}</p>}
        primary={
          <Button size="lg" variant="secondary" type="submit">
            {COPY.ready.overview}
          </Button>
        }
      >
        <ReadyStep
          actions={actions}
          onAction={(action) => open(action.kind, action.href)}
          testnet={testnet}
        />
      </OnboardingFrame>
    );
  }
  return (
    <OnboardingFrame
      {...frame}
      title={COPY.use.title}
      intro={COPY.use.intro}
      secondary={
        <Button
          size="lg"
          variant="ghost"
          loading={busy === "skip"}
          disabled={busy === "main"}
          onClick={() => void skip()}
        >
          {COPY.use.skip}
        </Button>
      }
      primary={continueButton}
    >
      <UseStep picked={picked} onToggle={toggle} />
    </OnboardingFrame>
  );
}
