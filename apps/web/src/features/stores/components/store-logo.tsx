"use client";

import { Button, TONES, useToast } from "@forwend/ui-web";
import { ImageUp, Trash2 } from "lucide-react";
import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
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
  /** A saved store: a chosen file uploads at once, apart from the form's Save. */
  store?: Store;
  /** A new store's chosen file, which the form uploads once the store is saved. */
  pending?: File | null;
  onPending?: (file: File | null) => void;
}

// R-135. The API checks the image; this only spares a request the API would refuse.
export function StoreLogo({ profileId, store, pending = null, onPending }: StoreLogoProps) {
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
    if (!store) return onPending?.(file);
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
    if (!store) return onPending?.(null);
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
          // Light in both themes, as on the pay page: most logos are drawn for a light page.
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

/** A local file's address for an image preview, released when the file changes or the preview goes. */
export function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}
