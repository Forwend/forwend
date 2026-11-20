import { SegmentedControl } from "@forwend/ui-web";
import { useEffect, useRef } from "react";
import { PAY_WAYS } from "@/features/pay/constants/pay";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import type { PayWay } from "@/features/pay/types/pay";

export interface PayWaysProps {
  way: PayWay;
  onChange: () => void;
  focused: boolean;
  onFocused: () => void;
}

const OPTIONS = [
  { value: PAY_WAYS.direct, label: COPY.ways.direct },
  { value: PAY_WAYS.cross, label: COPY.ways.cross },
] as const;

export function PayWays({ way, onChange, focused, onFocused }: PayWaysProps) {
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focused) return;
    tabs.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    onFocused();
  }, [focused, onFocused]);
  return (
    <div ref={tabs}>
      <SegmentedControl
        label={COPY.ways.label}
        options={OPTIONS}
        value={way}
        onValueChange={(next) => {
          if (next !== way) onChange();
        }}
        className="w-full"
      />
    </div>
  );
}
