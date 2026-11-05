"use client";

import {
  Badge,
  Button,
  buttonClasses,
  ChoiceCard,
  Form,
  FreelancerIcon,
  MerchantIcon,
  TextField,
} from "@forwend/ui-web";
import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { useCreateProfileMutation } from "@/features/profiles/api/profiles-api";
import { ProfileAvatar } from "@/features/profiles/components/profile-avatar";
import {
  NEW_PROFILE_KINDS,
  PROFILE_KIND_LABELS,
  PROFILE_KINDS,
  PROFILE_NAME_MAX,
  PROFILES_MAX,
  ROLES,
} from "@/features/profiles/constants/profile";
import { NEW_PROFILE_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import type { ProfileKind } from "@/features/profiles/types/profile";
import { APP_ROUTES } from "@/shared/config/routes";

type NewKind = (typeof NEW_PROFILE_KINDS)[number];

const KIND_ICONS = {
  [PROFILE_KINDS.freelancer]: FreelancerIcon,
  [PROFILE_KINDS.merchant]: MerchantIcon,
} as const;

// One idempotency key per filled-in form: a retry makes one profile and finishes its wallet.
export function NewProfileForm() {
  const { profiles, chooseProfile } = useAppSession();
  const [createProfile] = useCreateProfileMutation();
  const router = useRouter();
  const keys = useRef(new Map<string, string>());
  const [kind, setKind] = useState<NewKind>(PROFILE_KINDS.freelancer);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState("");
  const [formError, setFormError] = useState("");
  // The cap counts the profiles the user owns; ones they joined on a team are someone else's.
  const owned = profiles.filter((profile) => profile.role === ROLES.owner).length;
  const full = owned >= PROFILES_MAX;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (full) return setFormError(COPY.errors.cap);
    if ([...name.trim()].length > PROFILE_NAME_MAX) return setNameError(COPY.errors.name);
    setNameError("");
    setFormError("");
    setBusy(true);
    try {
      const body = { kind, name: name.trim() };
      const values = JSON.stringify(body);
      const key = keys.current.get(values) ?? crypto.randomUUID();
      keys.current.set(values, key);
      const profile = await createProfile({ idempotencyKey: key, body }).unwrap();
      chooseProfile(profile.profileId);
      router.push(APP_ROUTES.home);
    } catch (error) {
      const message =
        (error as { data?: { error?: { message?: string } } }).data?.error?.message ?? "";
      if (message.includes("profiles")) setFormError(COPY.errors.cap);
      else if (message.includes("name")) setNameError(COPY.errors.name);
      else setFormError(COPY.errors.failed);
      setBusy(false);
    }
  };

  const fresh = <NewRow kind={kind} name={name.trim()} />;
  return (
    <div className="grid justify-center gap-x-18 gap-y-8 pt-2 lg:grid-cols-[minmax(0,37.5rem)_minmax(0,22.5rem)] lg:pt-6">
      <Form onSubmit={submit} className="w-full max-w-[37.5rem]">
        <div className="flex flex-col gap-2">
          <h1 className="text-[1.625rem] leading-tight font-medium tracking-tight text-ink sm:text-[1.875rem]">
            {COPY.title}
          </h1>
          <p className="text-base text-pretty text-muted">{COPY.intro}</p>
        </div>
        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-2.5 text-sm font-medium text-ink">{COPY.kindLegend}</legend>
          <div className="grid grid-cols-2 gap-3">
            {NEW_PROFILE_KINDS.map((value) => (
              <ChoiceCard
                key={value}
                type="radio"
                name="kind"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
                icon={KIND_ICONS[value]}
                title={PROFILE_KIND_LABELS[value]}
                hint={
                  <>
                    {COPY.kinds[value].hint}
                    <ul className="flex flex-col gap-1.5 text-xs max-sm:hidden">
                      {COPY.kinds[value].includes.map((item) => (
                        <li key={item} className="flex items-center gap-2">
                          <Check aria-hidden className="size-3.5 shrink-0 text-accent" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </>
                }
              />
            ))}
          </div>
        </fieldset>
        <TextField
          label={COPY.nameLabel}
          placeholder={COPY.kinds[kind].placeholder}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameError("");
          }}
          error={nameError || undefined}
        />
        <div className="lg:hidden">{fresh}</div>
        <p role="alert" className="text-sm text-danger empty:hidden">
          {formError || (full ? COPY.errors.cap : "")}
        </p>
        {/* Phones: Create across the width, Cancel and the count under it. */}
        <div className="grid grid-cols-2 items-center gap-3 border-t border-line pt-4 sm:flex sm:justify-between">
          <Link
            href={APP_ROUTES.home}
            className={`${buttonClasses({ variant: "ghost", size: "lg" })} order-2 justify-self-start sm:order-none`}
          >
            {COPY.cancel}
          </Link>
          <div className="contents sm:flex sm:items-center sm:gap-4">
            <span className="order-3 justify-self-end text-sm text-muted tabular-nums sm:order-none">
              {COPY.count(owned, PROFILES_MAX)}
            </span>
            <Button
              type="submit"
              size="lg"
              loading={busy}
              disabled={full}
              className="order-1 col-span-2 sm:order-none sm:min-w-40"
            >
              {COPY.create}
            </Button>
          </div>
        </div>
      </Form>
      <aside className="hidden flex-col gap-3 pt-1.5 lg:flex">
        <p className="text-sm text-muted">{COPY.listTitle}</p>
        <ul className="flex flex-col gap-0.5 rounded-lg border border-line bg-surface p-2 shadow-sm">
          {profiles.map((profile) => (
            <li key={profile.profileId} className="flex items-center gap-3 rounded-md px-3 py-2.5">
              <ProfileAvatar kind={profile.kind} />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm text-ink">
                  {profile.name ?? PROFILE_KIND_LABELS[profile.kind]}
                </span>
                <span className="text-xs text-muted">{PROFILE_KIND_LABELS[profile.kind]}</span>
              </span>
            </li>
          ))}
          <li>{fresh}</li>
        </ul>
        <ul className="mt-2 flex flex-col gap-3 text-sm">
          {COPY.gets.map((point) => (
            <li key={point.title} className="flex gap-2.5">
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
              <span>
                <span className="font-medium text-ink">{point.title}</span>{" "}
                <span className="text-muted">{point.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

/** The profile this form makes, as the profile list will show it. */
function NewRow({ kind, name }: { kind: ProfileKind; name: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-dashed border-brand-edge bg-surface-2 px-3 py-2.5">
      <ProfileAvatar kind={kind} />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm font-medium text-ink">
          {name || PROFILE_KIND_LABELS[kind]}
        </span>
        <span className="text-xs text-muted">{COPY.newWallet(PROFILE_KIND_LABELS[kind])}</span>
      </span>
      <Badge tone="success">{COPY.newBadge}</Badge>
    </div>
  );
}
