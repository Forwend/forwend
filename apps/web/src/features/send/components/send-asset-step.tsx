import { EmptyState, formatTokenAmount } from "@forwend/ui-web";
import { WalletMinimal } from "lucide-react";
import { Choice, Choices } from "@/features/send/components/send-choices";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import type { SendOption } from "@/features/send/types/send";
import { TokenMark } from "@/shared/components/chains/token-mark";
import { exactDigits } from "@/shared/lib/money";

export interface SendAssetStepProps {
  options: SendOption[];
  onChoose: (option: SendOption) => void;
}

export function SendAssetStep({ options, onChoose }: SendAssetStepProps) {
  if (options.length === 0)
    return <EmptyState compact icon={WalletMinimal} title={SEND_COPY.nothingToSend} />;
  return (
    <Choices title={SEND_COPY.what} titleHidden>
      {options.map((o) => (
        <Choice
          key={`${o.chainId}-${o.token}`}
          icon={<TokenMark chainId={o.chainId} symbol={o.symbol} />}
          note={
            o.sendable
              ? `${formatTokenAmount({ baseUnits: o.balance, decimals: o.decimals, fractionDigits: exactDigits(o.balance, o.decimals) })} ${o.symbol}`
              : SEND_COPY.notSendable
          }
          disabled={!o.sendable}
          onClick={() => onChoose(o)}
        />
      ))}
    </Choices>
  );
}
