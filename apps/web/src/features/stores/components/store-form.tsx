"use client";

import {
  Button,
  buttonClasses,
  COPY_STATUS,
  Form,
  SelectField,
  type SelectOption,
  TextAreaField,
  TextField,
  TONES,
  useCopy,
  useToast,
} from "@forwend/ui-web";
import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useSaveStoreMutation } from "@/features/stores/api/stores-api";
import { StoreLogo } from "@/features/stores/components/store-logo";
import {
  BRAND_COLOR_PATTERN,
  COLOR_PICKER_START,
  STORE_LIMITS,
} from "@/features/stores/constants/stores";
import { STORES_COPY as COPY } from "@/features/stores/constants/stores-copy";
import { invalidStoreField, originLines } from "@/features/stores/lib/stores";
import type { Store, StoreBody, StoreField } from "@/features/stores/types/stores";
import { FieldGroup } from "@/shared/components/field-group";
import { APP_ROUTES } from "@/shared/config/routes";

export interface StoreFormProps {
  profileId: string;
  store?: Store;
  /** When the checkout closes, in seconds: New invoice's choices, which the screen passes in. */
  closeChoices: readonly SelectOption[];
  /** A new store's close: New invoice's default. */
  defaultClose: number;
}

// R-134: a new store's id is made once, so a retried save after an error makes one store.
export function StoreForm({ profileId, store, closeChoices, defaultClose }: StoreFormProps) {
  const [save] = useSaveStoreMutation();
  const toast = useToast();
  const router = useRouter();
  const storeId = useRef(store?.storeId ?? crypto.randomUUID());
  const [closes, setCloses] = useState(String(store?.defaultExpiresIn ?? defaultClose));
  const [color, setColor] = useState(store?.brandColor ?? "");
  const [errors, setErrors] = useState<Partial<Record<StoreField, string>>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body: StoreBody = {
      name: String(data.get("name") ?? "").trim(),
      defaultExpiresIn: Number(closes),
      allowedOrigins: originLines(String(data.get("allowedOrigins") ?? "")),
      brandColor: color.trim(),
    };
    const shown: Partial<Record<StoreField, string>> = {};
    if (!body.name) shown.name = COPY.errors.required;
    if (!BRAND_COLOR_PATTERN.test(body.brandColor))
      shown.brandColor = COPY.errors.invalid.brandColor;
    if (body.allowedOrigins.length > STORE_LIMITS.origins)
      shown.allowedOrigins = COPY.errors.tooMany;
    flushSync(() => {
      setErrors(shown);
      setFormError("");
    });
    if (Object.keys(shown).length > 0) {
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    setBusy(true);
    try {
      await save({ profileId, storeId: storeId.current, body }).unwrap();
      toast({ tone: TONES.success, title: COPY.saved(body.name) });
      router.push(APP_ROUTES.stores);
    } catch (error) {
      const message =
        (error as { data?: { error?: { message?: string } } }).data?.error?.message ?? "";
      const field = invalidStoreField(message);
      if (field) {
        flushSync(() => setErrors({ [field]: COPY.errors.invalid[field] }));
        form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      } else setFormError(COPY.errors.failed);
      setBusy(false);
    }
  };

  return (
    <Form onSubmit={submit}>
      <FieldGroup title={COPY.storeGroup}>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label={COPY.name}
            name="name"
            autoComplete="off"
            defaultValue={store?.name}
            maxLength={STORE_LIMITS.name}
            error={errors.name}
          />
          {store ? <ProjectId storeId={store.storeId} /> : null}
        </div>
      </FieldGroup>
      <FieldGroup title={COPY.brandGroup}>
        {store ? (
          <StoreLogo profileId={profileId} store={store} />
        ) : (
          <p className="text-sm text-muted">{COPY.logoAfterSave}</p>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label={COPY.color}
            name="brandColor"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            placeholder="#1f6a8c"
            autoComplete="off"
            spellCheck={false}
            maxLength={7}
            hint={COPY.colorHint}
            error={errors.brandColor}
            action={
              // The kit has no color picker; the browser's own one fills the field (docs/web/structure.md).
              <input
                type="color"
                aria-label={COPY.pickColor}
                value={
                  color.length === 7 && BRAND_COLOR_PATTERN.test(color) ? color : COLOR_PICKER_START
                }
                onChange={(event) => setColor(event.target.value)}
                className="aspect-square cursor-pointer rounded-md border border-field bg-surface p-1"
              />
            }
          />
        </div>
      </FieldGroup>
      <FieldGroup title={COPY.checkoutGroup}>
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField
            label={COPY.closesAfter}
            value={closes}
            onValueChange={setCloses}
            options={closeChoices}
            hint={COPY.closesAfterHint}
            error={errors.defaultExpiresIn}
          />
        </div>
        <TextAreaField
          label={COPY.origins}
          name="allowedOrigins"
          defaultValue={store?.allowedOrigins.join("\n")}
          placeholder="https://"
          autoComplete="off"
          spellCheck={false}
          hint={COPY.originsHint}
          error={errors.allowedOrigins}
        />
      </FieldGroup>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Button type="submit" loading={busy}>
          {COPY.save}
        </Button>
        <Link href={APP_ROUTES.stores} className={buttonClasses({ variant: "ghost" })}>
          {COPY.cancel}
        </Link>
      </div>
      <p role="alert" className="min-h-5 text-sm text-danger">
        {formError}
      </p>
    </Form>
  );
}

function ProjectId({ storeId }: { storeId: string }) {
  const [status, copy] = useCopy(storeId);
  const said =
    status === COPY_STATUS.copied
      ? COPY.copied
      : status === COPY_STATUS.failed
        ? COPY.copyFailed
        : "";
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-sm font-medium text-ink">{COPY.projectId}</p>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 truncate font-mono text-sm text-ink" title={storeId}>
          {storeId}
        </code>
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          {status === COPY_STATUS.copied ? (
            <Check aria-hidden className="size-[var(--fw-icon-sm)]" />
          ) : (
            <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
          )}
          <span aria-hidden>{said || COPY.copy}</span>
          <span className="sr-only">{COPY.copyLabel}</span>
        </Button>
      </div>
      <p className="text-sm text-muted">{COPY.projectIdHint}</p>
      <p role="status" className="sr-only">
        {said}
      </p>
    </div>
  );
}
