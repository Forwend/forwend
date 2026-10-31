"use client";

import {
  SelectField,
  type SelectOption,
  TextAreaField,
  TextField,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Payee } from "@/features/pay/components/payee";
import type { TokenRef, TokenSwitch } from "@/features/profiles/types/tokens";
import { useSaveStoreLogoMutation, useSaveStoreMutation } from "@/features/stores/api/stores-api";
import { StoreLogo, useObjectUrl } from "@/features/stores/components/store-logo";
import {
  BRAND_COLOR_PATTERN,
  COLOR_PICKER_START,
  STORE_LIMITS,
} from "@/features/stores/constants/stores";
import { STORES_COPY as COPY } from "@/features/stores/constants/stores-copy";
import { invalidStoreField, originLines } from "@/features/stores/lib/stores";
import type { Store, StoreBody, StoreField } from "@/features/stores/types/stores";
import { AssetSelection } from "@/shared/components/chains/asset-selection";
import { AssetStack } from "@/shared/components/chains/asset-stack";
import { TokenMark } from "@/shared/components/chains/token-mark";
import { FieldGroup } from "@/shared/components/field-group";
import { FormPreview, StepForm, useFormSteps } from "@/shared/components/step-form";
import { APP_ROUTES } from "@/shared/config/routes";

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

const STEPS = { store: "store", brand: "brand", assets: "assets" } as const;
const FIELD_STEPS: Record<StoreField, string> = {
  name: STEPS.store,
  defaultExpiresIn: STEPS.store,
  allowedOrigins: STEPS.store,
  brandColor: STEPS.brand,
  tokensOff: STEPS.assets,
};

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
  const [tokensOff, setTokensOff] = useState(() => new Set(store?.tokensOff.map(tokenKey)));
  const [errors, setErrors] = useState<Partial<Record<StoreField, string>>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(store?.name ?? "");
  // A new store's logo waits for the store to exist; a saved store's uploads at once.
  const [logo, setLogo] = useState<File | null>(null);
  const logoSrc = useObjectUrl(logo);
  const [saveLogo] = useSaveStoreLogoMutation();
  const flow = useFormSteps([
    { id: STEPS.store, label: COPY.storeGroup },
    { id: STEPS.brand, label: COPY.brandGroup },
    ...(shownTokens.length ? [{ id: STEPS.assets, label: COPY.tokensGroup }] : []),
  ]);
  const accepted = shownTokens.filter((t) => !tokensOff.has(tokenKey(t)));

  // Every problem the form has now, whichever step holds it.
  const problems = (form: HTMLFormElement) => {
    const shown: Partial<Record<StoreField, string>> = {};
    const typedName = String(new FormData(form).get("name") ?? "").trim();
    if (!typedName) shown.name = COPY.errors.required;
    if (!BRAND_COLOR_PATTERN.test(color.trim())) shown.brandColor = COPY.errors.invalid.brandColor;
    if (
      originLines(String(new FormData(form).get("allowedOrigins") ?? "")).length >
      STORE_LIMITS.origins
    )
      shown.allowedOrigins = COPY.errors.tooMany;
    if (shownTokens.length > 0 && accepted.length === 0) shown.tokensOff = COPY.errors.noToken;
    return shown;
  };

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
    const shown = problems(form);
    flushSync(() => {
      setErrors(shown);
      setFormError("");
    });
    if (Object.keys(shown).length > 0) return flow.focusError(form);
    setBusy(true);
    try {
      await save({ profileId, storeId: storeId.current, body }).unwrap();
      toast({ tone: TONES.success, title: COPY.saved(body.name) });
      if (!store && logo) {
        // The store is saved either way; a refused logo can be added again from its Edit page.
        await saveLogo({ profileId, storeId: storeId.current, logo })
          .unwrap()
          .catch(() => toast({ tone: TONES.danger, title: COPY.errors.logoFailed }));
      }
      router.push(`${APP_ROUTES.stores}/${storeId.current}`);
    } catch (error) {
      const message =
        (error as { data?: { error?: { message?: string } } }).data?.error?.message ?? "";
      const field = invalidStoreField(message);
      if (field) {
        flushSync(() => setErrors({ [field]: COPY.errors.invalid[field] }));
        flow.focusError(form);
      } else setFormError(COPY.errors.failed);
      setBusy(false);
    }
  };

  return (
    <StepForm
      label={COPY.stepsLabel}
      flow={flow}
      editing={Boolean(store)}
      cancelHref={store ? `${APP_ROUTES.stores}/${store.storeId}` : APP_ROUTES.stores}
      copy={COPY}
      busy={busy}
      onContinue={(form) => {
        const all = problems(form);
        const here = Object.fromEntries(
          Object.entries(all).filter(([field]) => FIELD_STEPS[field as StoreField] === flow.at),
        );
        flushSync(() => setErrors(here));
        if (Object.keys(here).length === 0) return true;
        flow.focusError(form);
        return false;
      }}
      onSubmit={submit}
      error={formError}
      preview={
        <FormPreview title={COPY.preview.title} note={COPY.preview.note}>
          <div className="flex flex-col gap-4 rounded-md bg-surface p-5 shadow-sm ring-1 ring-line">
            <Payee
              as="p"
              logoSrc={logoSrc}
              name={name.trim() || COPY.preview.noName}
              subtitle={COPY.preview.invoice}
              brand={{
                storeId: storeId.current,
                logoAt: store?.logoAt ?? null,
                color: BRAND_COLOR_PATTERN.test(color) && color ? color : null,
              }}
            />
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <p className="text-xs font-medium text-muted">{COPY.preview.payWith}</p>
              {accepted.length === 1 && accepted[0] ? (
                <TokenMark chainId={accepted[0].chainId} symbol={accepted[0].symbol} />
              ) : (
                <AssetStack assets={accepted} label={COPY.preview.options(accepted.length)} />
              )}
            </div>
            <p className="border-t border-line pt-4 text-sm text-muted">
              {COPY.preview.closes(closeChoices.find((c) => c.value === closes)?.label ?? closes)}
            </p>
          </div>
        </FormPreview>
      }
    >
      <div data-step={STEPS.store} className={flow.shows(STEPS.store)}>
        <FieldGroup title={COPY.storeGroup}>
          <TextField
            label={COPY.name}
            name="name"
            autoComplete="off"
            defaultValue={store?.name}
            onChange={(event) => setName(event.target.value)}
            maxLength={STORE_LIMITS.name}
            error={errors.name}
          />
          <SelectField
            label={COPY.closesAfter}
            value={closes}
            onValueChange={setCloses}
            options={closeChoices}
            error={errors.defaultExpiresIn}
          />
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
      </div>
      <div data-step={STEPS.brand} className={flow.shows(STEPS.brand)}>
        <FieldGroup title={COPY.brandGroup}>
          <StoreLogo profileId={profileId} store={store} pending={logo} onPending={setLogo} />
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
        </FieldGroup>
      </div>
      {shownTokens.length > 0 ? (
        <div data-step={STEPS.assets} className={flow.shows(STEPS.assets)}>
          <FieldGroup title={COPY.tokensGroup}>
            <AssetSelection
              label={COPY.tokensGroup}
              options={shownTokens}
              selected={new Set(accepted.map(tokenKey))}
              onChange={(keys, on) => {
                const next = new Set(tokensOff);
                for (const key of keys) {
                  if (on) next.delete(key);
                  else next.add(key);
                }
                setTokensOff(next);
                setErrors((current) => ({ ...current, tokensOff: undefined }));
              }}
            />
            <p
              role="alert"
              tabIndex={-1}
              data-invalid={errors.tokensOff ? "" : undefined}
              className="text-sm text-danger outline-none empty:hidden"
            >
              {errors.tokensOff}
            </p>
            <p id="store-tokens-hint" className="text-sm text-muted">
              {COPY.tokensHint}
            </p>
          </FieldGroup>
        </div>
      ) : null}
    </StepForm>
  );
}
