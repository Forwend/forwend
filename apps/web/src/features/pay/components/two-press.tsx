import { Button } from "@forwend/ui-web";
import { useState } from "react";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";

export interface TwoPressProps {
  onConfirm: () => void;
  label?: string;
  className?: string;
}

/** Two presses to leave a shown address, so a payer who sent can't switch by accident and pay twice. */
export function TwoPress({ onConfirm, label, className }: TwoPressProps) {
  const [asking, setAsking] = useState(false);
  return (
    <Button
      size="sm"
      variant={asking ? "secondary" : "ghost"}
      aria-label={asking ? undefined : label}
      className={className}
      onBlur={() => setAsking(false)}
      onClick={() => {
        if (!asking) return setAsking(true);
        setAsking(false);
        onConfirm();
      }}
    >
      {asking ? COPY.confirmChange : COPY.change}
    </Button>
  );
}
