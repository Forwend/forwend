"use client";

import {
  Button,
  buttonClasses,
  ChoiceCard,
  Form,
  FreelancerIcon,
  MerchantIcon,
  TextField,
} from "@forwend/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { useCreateProfileMutation } from "@/features/profiles/api/profiles-api";
import {
  NEW_PROFILE_KINDS,
  PROFILE_KIND_LABELS,
  PROFILE_KINDS,
  PROFILE_NAME_MAX,
} from "@/features/profiles/constants/profile";
import { NEW_PROFILE_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import type { ProfileKind } from "@/features/profiles/types/profile";
import { APP_ROUTES } from "@/shared/config/routes";

const KIND_ICONS = {
  [PROFILE_KINDS.freelancer]: FreelancerIcon,
  [PROFILE_KINDS.merchant]: MerchantIcon,
} as const;

// One idempotency key per filled-in form: a retry makes one profile and finishes its wallet.
export function NewProfileForm() {
  const { chooseProfile } = useAppSession();
  const [createProfile] = useCreateProfileMutation();
  const router = useRouter();
  const keys = useRef(new Map<string, string>());
  const [kind, setKind] = useState<ProfileKind>(PROFILE_KINDS.freelancer);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState("");
  const [formError, setFormError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
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

  return (
    <Form onSubmit={submit}>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium text-ink">{COPY.kindLegend}</legend>
        <div className="grid grid-cols-2 gap-3">
          {NEW_PROFILE_KINDS.map((value) => {
            return (
              <ChoiceCard
                key={value}
                type="radio"
                name="kind"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
                icon={KIND_ICONS[value]}
                title={PROFILE_KIND_LABELS[value]}
                hint={COPY.kindHints[value]}
              />
            );
          })}
        </div>
      </fieldset>
      <TextField
        label={COPY.nameLabel}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setNameError("");
        }}
        error={nameError || undefined}
        className="min-h-26"
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Button type="submit" loading={busy}>
          {COPY.create}
        </Button>
        <Link href={APP_ROUTES.home} className={buttonClasses({ variant: "ghost" })}>
          {COPY.cancel}
        </Link>
      </div>
      <p role="alert" className="min-h-5 text-sm text-danger">
        {formError}
      </p>
    </Form>
  );
}
