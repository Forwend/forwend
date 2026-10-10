"use client";

import { Button, FreelancerIcon, MerchantIcon, TextField } from "@forwend/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { useAppSession } from "@/features/profiles/app-session";
import {
  NEW_PROFILE_KINDS,
  PROFILE_KIND_LABELS,
  PROFILE_KINDS,
  PROFILE_NAME_MAX,
  type ProfileKind,
} from "@/features/profiles/profile";
import { useCreateProfileMutation } from "@/features/profiles/profiles-api";
import { NEW_PROFILE_COPY as COPY } from "@/features/profiles/profiles-copy";
import { APP_ROUTES } from "@/shared/config/routes";

const KIND_ICONS = {
  [PROFILE_KINDS.freelancer]: FreelancerIcon,
  [PROFILE_KINDS.merchant]: MerchantIcon,
} as const;

// One idempotency key per filled-in form: a double click, or a retry of the same values after an error, makes one
// profile (and the retry finishes its wallet); changed values are a new request with a new key, never a 409.
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
    } catch {
      setFormError(COPY.errors.failed);
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium text-ink">{COPY.kindLegend}</legend>
        <div className="grid grid-cols-2 gap-3">
          {NEW_PROFILE_KINDS.map((value) => {
            const Icon = KIND_ICONS[value];
            return (
              <label
                key={value}
                className="flex cursor-pointer flex-col items-start gap-1 rounded-lg border border-line-strong bg-surface p-4 text-ink transition-[border-color,box-shadow] duration-[var(--fw-duration-fast)] has-checked:border-ink has-checked:shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
              >
                <input
                  type="radio"
                  name="kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                  className="sr-only"
                />
                <Icon className="mb-2 size-[var(--fw-icon-lg)] text-accent" />
                <span className="font-medium">{PROFILE_KIND_LABELS[value]}</span>
                <span className="text-sm text-muted">{COPY.kindHints[value]}</span>
              </label>
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
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy}>
          {COPY.create}
        </Button>
        <Link
          href={APP_ROUTES.home}
          className="rounded-pill px-3 py-2 text-sm text-muted hover:text-ink"
        >
          {COPY.cancel}
        </Link>
      </div>
      <p role="alert" className="min-h-5 text-sm text-danger">
        {formError}
      </p>
    </form>
  );
}
