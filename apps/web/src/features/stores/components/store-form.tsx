"use client";

import {
  Button,
  buttonClasses,
  Checkbox,
  Form,
  SearchField,
  SelectField,
  type SelectOption,
  TextAreaField,
  TextField,
  TONES,
  useToast,
} from "@forwend/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { TOKENS_COPY } from "@/features/profiles/constants/profiles-copy";
import type { TokenRef, TokenSwitch } from "@/features/profiles/types/tokens";
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
import { CopyValue } from "@/shared/components/copy-value";
import { FieldGroup } from "@/shared/components/field-group";
import { APP_ROUTES } from "@/shared/config/routes";
import { chainName, TOKEN_SEARCH_FROM, tokenMatches } from "@/shared/lib/chains";

export interface StoreFormProps {
  profileId: string;
  store?: Store;
  /** When the checkout closes, in seconds: New invoice's choices, which the screen passes in. */
  closeChoices: readonly SelectOption[];
  /** A new store's close: New invoice's default. */
  defaultClose: number;
  /** The profile's tokens (R-136): the store narrows the ones on. */
  tokens: readonly TokenSwitch[];
}

const tokenKey = (t: TokenRef) => `${t.chainId}:${t.token}`;

// R-134: a new store's id is made once, so a retried save after an error makes one store.
export function StoreForm({
  profileId,
  store,
  closeChoices,
  defaultClose,
  tokens,
}: StoreFormProps) {
  const [save] = useSaveStoreMutation();
  const toast = useToast();
  const router = useRouter();
  const storeId = useRef(store?.storeId ?? crypto.randomUUID());
  const [closes, setCloses] = useState(String(store?.defaultExpiresIn ?? defaultClose));
  const [color, setColor] = useState(store?.brandColor ?? "");
  const shownTokens = tokens.filter((t) => t.on);
  const [tokenQuery, setTokenQuery] = useState("");
  const [tokensOff, setTokensOff] = useState(() => new Set(store?.tokensOff.map(tokenKey)));
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
      // Ones the profile has off stay as the store had them: the store can't turn them on.
      tokensOff: [
        ...(store?.tokensOff ?? []).filter(
          (t) => !shownTokens.some((s) => tokenKey(s) === tokenKey(t)),
        ),
        ...shownTokens
          .filter((t) => tokensOff.has(tokenKey(t)))
          .map(({ chainId, token }) => ({ chainId, token })),
      ],
    };
    const shown: Partial<Record<StoreField, string>> = {};
    if (!body.name) shown.name = COPY.errors.required;
    if (!BRAND_COLOR_PATTERN.test(body.brandColor))
      shown.brandColor = COPY.errors.invalid.brandColor;
    if (body.allowedOrigins.length > STORE_LIMITS.origins)
      shown.allowedOrigins = COPY.errors.tooMany;
    if (shownTokens.length > 0 && shownTokens.every((t) => tokensOff.has(tokenKey(t))))
      shown.tokensOff = COPY.errors.noToken;
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
      router.push(`${APP_ROUTES.stores}/${storeId.current}`);
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
          {store ? (
            <CopyValue
              label={COPY.projectId}
              value={store.storeId}
              hint={COPY.projectIdHint}
              copyLabel={COPY.copyLabel}
            />
          ) : null}
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
      {shownTokens.length > 0 ? (
        <FieldGroup title={COPY.tokensGroup}>
          {shownTokens.length > TOKEN_SEARCH_FROM ? (
            <SearchField
              label={TOKENS_COPY.search}
              placeholder={TOKENS_COPY.searchPlaceholder}
              value={tokenQuery}
              onValueChange={setTokenQuery}
              className="sm:max-w-sm"
            />
          ) : null}
          <fieldset
            aria-describedby="store-tokens-hint"
            className="grid max-h-96 gap-1 overflow-y-auto sm:grid-cols-2"
          >
            <legend className="sr-only">{COPY.tokensGroup}</legend>
            {shownTokens
              .filter((t) => tokenMatches(t, tokenQuery))
              .map((t) => (
                <Checkbox
                  key={tokenKey(t)}
                  label={TOKENS_COPY.toggle(t.symbol, chainName(t.chainId))}
                  checked={!tokensOff.has(tokenKey(t))}
                  onChange={(event) => {
                    const next = new Set(tokensOff);
                    if (event.target.checked) next.delete(tokenKey(t));
                    else next.add(tokenKey(t));
                    setTokensOff(next);
                    setErrors((current) => ({ ...current, tokensOff: undefined }));
                  }}
                />
              ))}
          </fieldset>
          <p role="alert" className="text-sm text-danger empty:hidden">
            {errors.tokensOff}
          </p>
          <p id="store-tokens-hint" className="text-sm text-muted">
            {COPY.tokensHint}
          </p>
        </FieldGroup>
      ) : null}
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
        <Link
          href={store ? `${APP_ROUTES.stores}/${store.storeId}` : APP_ROUTES.stores}
          className={buttonClasses({ variant: "ghost" })}
        >
          {COPY.cancel}
        </Link>
      </div>
      <p role="alert" className="min-h-5 text-sm text-danger">
        {formError}
      </p>
    </Form>
  );
}
