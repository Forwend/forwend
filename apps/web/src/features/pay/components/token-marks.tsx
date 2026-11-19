import type { CrossChain } from "@/features/pay/types/crosschain";
import { MarkIcon } from "@/shared/components/chains/token-mark";
import {
  BLOCKCHAIN_ICONS,
  CHAINS,
  CROSS_CHAIN_TOKEN_ICONS,
  TOKEN_ICONS,
} from "@/shared/constants/chains";
import { chainLogo, iconOf } from "@/shared/lib/chains";

// Marks small enough for a line of text: the token, with its network on the corner.

export function PayTokenMark({ chainId, symbol }: { chainId: number; symbol: string }) {
  return (
    <MarkIcon
      small
      token={TOKEN_ICONS[symbol]}
      chain={CHAINS[chainId]?.icon}
      letter={symbol.slice(0, 1)}
    />
  );
}

export function OriginMark({ crossChain }: { crossChain: CrossChain }) {
  return (
    <MarkIcon
      small
      token={iconOf(CROSS_CHAIN_TOKEN_ICONS, crossChain.symbol)}
      chain={iconOf(BLOCKCHAIN_ICONS, crossChain.blockchain)}
      letter={crossChain.symbol.slice(0, 1)}
      chainLogo={chainLogo(crossChain.blockchain)}
    />
  );
}
