import { EmptyState } from "@forwend/ui-web";
import { Users, WalletMinimal } from "lucide-react";
import { profileLabel } from "@/features/profiles/lib/profile";
import type { Profile } from "@/features/profiles/types/profile";
import { Choice, Choices } from "@/features/send/components/send-choices";
import { SEND_MODES } from "@/features/send/constants/send";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import type { SendMode } from "@/features/send/types/send";

export interface SendRecipientStepProps {
  mode: SendMode;
  own: Profile[];
  onProfile: (profile: Profile) => void;
  onAddress: () => void;
}

export function SendRecipientStep({ mode, own, onProfile, onAddress }: SendRecipientStepProps) {
  if (own.length === 0)
    return (
      <EmptyState
        compact
        icon={Users}
        title={SEND_COPY.noOtherProfiles}
        description={SEND_COPY.noOtherProfilesHint}
      />
    );
  return (
    <div className="flex flex-col gap-5">
      <Choices title={SEND_COPY.yourProfiles}>
        {own.map((p) => (
          <Choice
            key={p.profileId}
            icon={<Initial text={profileLabel(p)} />}
            label={profileLabel(p)}
            onClick={() => onProfile(p)}
          />
        ))}
      </Choices>
      {mode === SEND_MODES.send ? (
        <Choices title={SEND_COPY.anotherWallet}>
          <Choice
            icon={
              <span className="grid size-9 place-items-center rounded-pill bg-surface-2 text-muted">
                <WalletMinimal aria-hidden className="size-[var(--fw-icon-sm)]" />
              </span>
            }
            label={SEND_COPY.walletAddress}
            note={SEND_COPY.walletAddressNote}
            onClick={onAddress}
          />
        </Choices>
      ) : null}
    </div>
  );
}

function Initial({ text }: { text: string }) {
  return (
    <span
      aria-hidden
      className="grid size-9 place-items-center rounded-pill bg-surface-2 text-sm font-medium text-ink"
    >
      {text.slice(0, 1)}
    </span>
  );
}
