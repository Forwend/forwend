import { Money } from "@forwend/ui-web";
import { PAYMENT_EXAMPLE as example } from "./constants/example-payment";

export function ExampleAmount() {
  return (
    <Money
      baseUnits={example.baseUnits}
      decimals={example.decimals}
      token={example.symbol}
      fractionDigits={2}
    />
  );
}
