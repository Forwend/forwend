import { useRecheckInvoiceMutation } from "@/features/invoices/api/invoices-api";
import { recheckKey } from "@/features/invoices/hooks/use-check-status";
import { PAY_STATES } from "@/features/pay/constants/pay";
import type { PayStatus } from "@/features/pay/types/pay";

export function useFound(linkToken: string, pay: PayStatus): bigint {
  const [, { data: recheck }] = useRecheckInvoiceMutation({ fixedCacheKey: recheckKey(linkToken) });
  const missing = BigInt(recheck?.onChain ?? "0") - BigInt(recheck?.recorded ?? "0");
  return pay.state === PAY_STATES.waiting && recheck?.rescanning && missing > 0n ? missing : 0n;
}
