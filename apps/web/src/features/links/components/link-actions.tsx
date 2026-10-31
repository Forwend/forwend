"use client";

import {
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { Ellipsis, Pencil, Power, PowerOff } from "lucide-react";
import NextLink from "next/link";
import { useSaveLinkMutation } from "@/features/links/api/links-api";
import { LINK_SETUP_REQUIRED_CODE } from "@/features/links/constants/links";
import { LINKS_COPY as COPY } from "@/features/links/constants/links-copy";
import type { Link } from "@/features/links/types/links";
import { APP_ROUTES } from "@/shared/config/routes";

export interface LinkActionsProps {
  profileId: string;
  link: Link;
}

// R-140: Turn off or on saves the link as it is, with only `active` changed.
export function LinkActions({ profileId, link }: LinkActionsProps) {
  const [save, { isLoading }] = useSaveLinkMutation();
  const toast = useToast();

  const toggle = async () => {
    const active = !link.active;
    try {
      await save({
        profileId,
        linkId: link.linkId,
        body: {
          title: link.title,
          ...(link.storeId ? { storeId: link.storeId } : {}),
          amountUsd: link.amountUsd,
          minUsd: link.minUsd,
          maxUsd: link.maxUsd,
          endsAt: link.endsAt,
          maxPayments: link.maxPayments,
          active,
        },
      }).unwrap();
      toast({
        tone: TONES.success,
        title: active ? COPY.turnedOn(link.title) : COPY.turnedOff(link.title),
      });
    } catch (error) {
      const code = (error as { data?: { error?: { code?: string } } }).data?.error?.code;
      toast({
        tone: TONES.warning,
        title: code === LINK_SETUP_REQUIRED_CODE ? COPY.errors.notReady : COPY.toggleFailed,
      });
    }
  };

  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label={COPY.moreActions} title={COPY.moreActions} size="md">
          <Ellipsis aria-hidden className="size-[var(--fw-icon-md)]" />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end" className="w-56">
        <MenuItem asChild>
          <NextLink href={`${APP_ROUTES.links}/${link.linkId}/edit`}>
            <Pencil aria-hidden className="size-[var(--fw-icon-sm)]" />
            {COPY.edit}
          </NextLink>
        </MenuItem>
        <MenuItem disabled={isLoading} onSelect={() => void toggle()}>
          {link.active ? (
            <PowerOff aria-hidden className="size-[var(--fw-icon-sm)]" />
          ) : (
            <Power aria-hidden className="size-[var(--fw-icon-sm)]" />
          )}
          {link.active ? COPY.turnOff : COPY.turnOn}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
