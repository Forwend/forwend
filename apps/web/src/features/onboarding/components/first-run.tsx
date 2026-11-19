"use client";

import { Button } from "@forwend/ui-web";
import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useAddPasskey } from "@/features/auth/hooks/use-add-passkey";
import { addPasskeyError } from "@/features/auth/lib/passkeys";
import {
  type DetailsField,
  DetailsPreview,
  DetailsStep,
} from "@/features/onboarding/components/details-step";
import { OnboardingFrame } from "@/features/onboarding/components/onboarding-frame";
import { PasskeyLead, PasskeyStep } from "@/features/onboarding/components/passkey-step";
import { ReadyLead, ReadyStep } from "@/features/onboarding/components/ready-step";
import { TokensStep } from "@/features/onboarding/components/tokens-step";
import { UseStep } from "@/features/onboarding/components/use-step";
import { ONBOARDING_CHOICES, ONBOARDING_STEPS } from "@/features/onboarding/constants/onboarding";
import { FIRST_RUN_COPY as COPY } from "@/features/onboarding/constants/onboarding-copy";
import { useFirstRunSave } from "@/features/onboarding/hooks/use-first-run-save";
import {
  billingBody,
  landingProfile,
  onboardingSteps,
  takeReturnPage,
  websiteOrigin,
} from "@/features/onboarding/lib/onboarding";
import type { OnboardingChoice, ProfileDetails } from "@/features/onboarding/types/onboarding";
import { useGetProfileTokensQuery } from "@/features/profiles/api/profiles-api";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { billingErrors } from "@/features/profiles/lib/billing-details";
import type { NewProfileKind, Profile } from "@/features/profiles/types/profile";
import { assetKey } from "@/shared/components/chains/asset-selection";
import { selectionSummary } from "@/shared/lib/asset-selection";

const PHONE_OUTLINE =
  "max-sm:border max-sm:border-line max-sm:bg-surface dark:max-sm:border-line-strong";

const DETAILS_STEPS = {
  [ONBOARDING_STEPS.freelancerDetails]: PROFILE_KINDS.freelancer,
  [ONBOARDING_STEPS.merchantDetails]: PROFILE_KINDS.merchant,
} as const;

export interface FirstRunProps {
  profiles: readonly Profile[];
  email: string;
  passkeyLinked: boolean;
  onSignOut: () => void;
  onFinish: (profile: Profile, href: string) => void;
}

export function FirstRun({
  profiles: live,
  email,
  passkeyLinked,
  onSignOut,
  onFinish,
}: FirstRunProps) {
  // Fixed: the onboarding call adds the new profiles to the live list.
  const [profiles] = useState(live);
  const addPasskey = useAddPasskey();
  const personal = profiles.find((p) => p.kind === PROFILE_KINDS.personal) ?? profiles[0];
  const saving = useFirstRunSave(profiles, personal);
  const tokens = useGetProfileTokensQuery(personal?.profileId ?? "", { skip: !personal });
  const testnet = !personal?.livemode;

  const [picked, setPicked] = useState<OnboardingChoice[]>([]);
  // Fixed: adding a passkey on its step must not shift the steps after it.
  const [hadPasskey] = useState(passkeyLinked);
  const steps = useMemo(() => onboardingSteps(picked, hadPasskey), [picked, hadPasskey]);
  const [at, setAt] = useState(0);
  const step = steps[at];
  const [details, setDetails] = useState<Record<NewProfileKind, ProfileDetails>>({
    [PROFILE_KINDS.freelancer]: { name: "", email, country: "", address: "" },
    [PROFILE_KINDS.merchant]: { name: "", email, country: "", address: "" },
  });
  const [merchantTouched, setMerchantTouched] = useState<ReadonlySet<keyof ProfileDetails>>(
    new Set(),
  );
  const [skipped, setSkipped] = useState<ReadonlySet<NewProfileKind>>(new Set());
  const [website, setWebsite] = useState("");
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const selected = chosen ?? new Set((tokens.data ?? []).filter((t) => t.on).map(assetKey));
  const [errors, setErrors] = useState<Partial<Record<DetailsField, string>>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"main" | "skip" | null>(null);

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
  const edit = (kind: NewProfileKind) => (field: keyof ProfileDetails, value: string) => {
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
      const profile = await saving.skip();
      if (profile) onFinish(profile, takeReturnPage());
    } catch {
      setError(COPY.failed);
      setBusy(null);
    }
  };

  const finish = async (withTokens: boolean) => {
    setBusy(withTokens ? "main" : "skip");
    setError("");
    try {
      await saving.save({
        picked,
        details,
        skipped,
        website,
        tokensOff:
          withTokens && tokens.data
            ? tokens.data
                .filter((t) => !selected.has(assetKey(t)))
                .map(({ chainId, token }) => ({ chainId, token }))
            : null,
      });
      next();
    } catch {
      setError(COPY.failed);
    } finally {
      setBusy(null);
    }
  };
  const skipDetails = (kind: NewProfileKind) => {
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
      const shown: Partial<Record<DetailsField, string>> = billingErrors(billingBody(typed));
      if (kind === PROFILE_KINDS.merchant && website.trim() && !websiteOrigin(website)) {
        shown.website = COPY.details.websiteInvalid;
      }
      if (Object.keys(shown).length > 0) return showErrors(shown);
      setSkipped((was) => {
        const now = new Set(was);
        now.delete(kind);
        return now;
      });
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
      // Saving before the list loads would keep defaults the user never saw.
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
        setError(addPasskeyError(e, COPY.passkey.failed));
      } finally {
        setBusy(null);
      }
    }
  };

  const landing = landingProfile(profiles, saving.after) ?? personal;
  const open = (kind: string, href: string) => {
    const profile = saving.after.find((p) => p.kind === kind) ?? landing;
    if (profile) onFinish(profile, href);
  };
  // Once the profiles exist the uses can't change, so Back stops after them.
  const backButton =
    at > 0 && !(saving.made && steps[at - 1] === ONBOARDING_STEPS.use) ? (
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
        <ReadyStep picked={picked} onAction={open} testnet={testnet} />
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
