"use client";

import { Button, TONES, useToast } from "@forwend/ui-web";
import { ImageUp, Trash2 } from "lucide-react";
import Image from "next/image";
import { useId, useRef, useState } from "react";
import {
  useDeleteStoreLogoMutation,
  useSaveStoreLogoMutation,
} from "@/features/stores/api/stores-api";
import { LOGO_TYPES, STORE_LIMITS } from "@/features/stores/constants/stores";
import { STORES_COPY as COPY } from "@/features/stores/constants/stores-copy";
import { useObjectUrl } from "@/features/stores/hooks/use-object-url";
import { storeLogoUrl } from "@/features/stores/lib/stores";
import type { Store } from "@/features/stores/types/stores";
import { invalidValue } from "@/shared/api/api-error";

export interface StoreLogoProps {
  profileId: string;
  store?: Store;
  pending: File | null;
  onPending: (file: File | null) => void;
}

export function StoreLogo({ profileId, store, pending, onPending }: StoreLogoProps) {
  const [saveLogo, saving] = useSaveStoreLogoMutation();
  const [deleteLogo, deleting] = useDeleteStoreLogoMutation();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [error, setError] = useState("");
  const busy = saving.isLoading || deleting.isLoading;
  const local = useObjectUrl(pending);
  const src = store?.logoAt ? storeLogoUrl(store.storeId, store.logoAt) : local;

  const upload = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    if (
      !(LOGO_TYPES as readonly string[]).includes(file.type) ||
      file.size > STORE_LIMITS.logoBytes
    ) {
      setError(COPY.errors.logo);
      return;
    }
    setError("");
    if (!store) return onPending(file);
    try {
      await saveLogo({ profileId, storeId: store.storeId, logo: file }).unwrap();
      toast({ tone: TONES.success, title: COPY.logoSaved });
    } catch (failure) {
      setError(invalidValue(failure) ? COPY.errors.logo : COPY.errors.logoFailed);
    }
  };
  const remove = async () => {
    setError("");
    if (!store) return onPending(null);
    try {
      await deleteLogo({ profileId, storeId: store.storeId }).unwrap();
      toast({ tone: TONES.success, title: COPY.logoRemoved });
    } catch {
      setError(COPY.errors.logoFailed);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium text-ink">{COPY.logo}</p>
      <div className="flex flex-wrap items-center gap-3">
        {src ? (
          // Light in both themes: most logos are drawn for a light page.
          <span
            data-theme="light"
            className="grid h-14 max-w-48 place-items-center rounded-md bg-surface px-2"
          >
            <Image
              src={src}
              alt={COPY.logoAlt(store?.name ?? COPY.logo)}
              width={176}
              height={40}
              unoptimized
              className="h-10 w-auto max-w-44 object-contain"
            />
          </span>
        ) : (
          <p className="text-sm text-muted">{COPY.noLogo}</p>
        )}
        {/* The kit has no file field (docs/web/structure.md). */}
        <input
          ref={input}
          type="file"
          accept={LOGO_TYPES.join(",")}
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => void upload(event.target.files?.[0])}
        />
        <Button
          size="sm"
          variant="secondary"
          loading={saving.isLoading}
          disabled={busy}
          aria-describedby={hintId}
          onClick={() => input.current?.click()}
        >
          <ImageUp aria-hidden className="size-[var(--fw-icon-sm)]" />
          {src ? COPY.replaceLogo : COPY.uploadLogo}
        </Button>
        {src ? (
          <Button
            size="sm"
            variant="ghost"
            loading={deleting.isLoading}
            disabled={busy}
            onClick={() => void remove()}
          >
            <Trash2 aria-hidden className="size-[var(--fw-icon-sm)]" />
            {COPY.removeLogo}
          </Button>
        ) : null}
      </div>
      <p role="alert" className="text-sm text-danger empty:hidden">
        {error}
      </p>
      <p id={hintId} className="text-sm text-muted">
        {store ? COPY.logoHint : COPY.logoHintNew}
      </p>
    </div>
  );
}
