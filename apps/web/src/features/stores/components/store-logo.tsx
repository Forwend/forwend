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
import { storeLogoUrl } from "@/features/stores/lib/stores";
import type { Store } from "@/features/stores/types/stores";

export interface StoreLogoProps {
  profileId: string;
  store: Store;
}

// R-135: a chosen file uploads at once, apart from the form's Save. The API checks the image; this only spares a
// request the API would refuse.
export function StoreLogo({ profileId, store }: StoreLogoProps) {
  const [saveLogo, saving] = useSaveStoreLogoMutation();
  const [deleteLogo, deleting] = useDeleteStoreLogoMutation();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [error, setError] = useState("");
  const busy = saving.isLoading || deleting.isLoading;

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
    try {
      await saveLogo({ profileId, storeId: store.storeId, logo: file }).unwrap();
      toast({ tone: TONES.success, title: COPY.logoSaved });
    } catch (failure) {
      setError(
        (failure as { status?: unknown }).status === 422
          ? COPY.errors.logo
          : COPY.errors.logoFailed,
      );
    }
  };
  const remove = async () => {
    setError("");
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
        {store.logoAt ? (
          // Light in both themes, as on the pay page: most logos are drawn for a light page.
          <span
            data-theme="light"
            className="grid h-14 max-w-48 place-items-center rounded-md border border-line bg-surface px-2"
          >
            <Image
              src={storeLogoUrl(store.storeId, store.logoAt)}
              alt={COPY.logoAlt(store.name)}
              width={176}
              height={40}
              unoptimized
              className="h-10 w-auto max-w-44 object-contain"
            />
          </span>
        ) : (
          <p className="text-sm text-muted">{COPY.noLogo}</p>
        )}
        {/* The kit has no file field; the button opens the browser's own picker (docs/web/structure.md). */}
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
          {store.logoAt ? COPY.replaceLogo : COPY.uploadLogo}
        </Button>
        {store.logoAt ? (
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
        {COPY.logoHint}
      </p>
    </div>
  );
}
