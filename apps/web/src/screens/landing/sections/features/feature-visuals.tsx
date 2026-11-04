import { Money, PAYMENT_STATUS, PaymentTimeline, STEP_STATES, StatusPill } from "@forwend/ui-web";
import { Copy, FileText, Link2 } from "lucide-react";
import { TokenMark } from "@/shared/components/chains/token-mark";
import { SITE } from "@/shared/config/site";
import { chainName } from "@/shared/lib/chains";
import { PAYMENT_EXAMPLE as example } from "../example-payment/constants/example-payment";
import { ExampleAmount } from "../example-payment/example-amount";
import styles from "./product-features.module.css";

function Usdc({ baseUnits }: { baseUnits: bigint }) {
  return <Money baseUnits={baseUnits} decimals={6} token="USDC" fractionDigits={2} />;
}

export function InvoiceVisual() {
  return (
    <div className={styles.stack}>
      <div className={styles.sheet}>
        <div className={styles.sheetTop}>
          <strong>{example.recipient}</strong>
          <span>Invoice {example.invoice}</span>
        </div>
        <dl className={styles.parties}>
          <div>
            <dt>Bill to</dt>
            <dd>{example.customer}</dd>
          </div>
          <div>
            <dt>Due</dt>
            <dd>14 Nov 2026</dd>
          </div>
        </dl>
        <div className={styles.line}>
          <span>{example.description}</span>
          <Usdc baseUnits={1000000000n} />
        </div>
        <div className={styles.line}>
          <span>Hosting setup</span>
          <Usdc baseUnits={250000000n} />
        </div>
        <div className={styles.total}>
          <span>Total due</span>
          <strong>
            <ExampleAmount />
          </strong>
        </div>
        <div className={styles.sheetFoot}>
          <span>
            <FileText className="size-3.5" /> Invoice PDF
          </span>
          <span>{chainName(example.chainId)} · Testnet</span>
        </div>
      </div>
      <div className={`${styles.float} ${styles.floatTop}`}>
        <StatusPill status={PAYMENT_STATUS.paid} />
        <span>Alex paid {example.invoice}</span>
      </div>
    </div>
  );
}

export function LinkVisual() {
  return (
    <div className={styles.stack}>
      <div className={styles.sheet}>
        <span className={styles.kicker}>Payment link</span>
        <strong className={styles.sheetTitle}>Logo design</strong>
        <div className={styles.url}>
          <Link2 className="size-4" />
          <span>{new URL(SITE.url).host}/l/north-co-logo</span>
          <Copy className="size-4" />
        </div>
        <div className={styles.line}>
          <span>Fixed price</span>
          <Usdc baseUnits={450000000n} />
        </div>
        <div className={styles.line}>
          <span>Paid so far</span>
          <span>3 buyers</span>
        </div>
      </div>
      <div className={`${styles.float} ${styles.floatCheckout}`}>
        <span className={styles.kicker}>Pay {example.recipient}</span>
        <strong className={styles.checkoutAmount}>
          <Usdc baseUnits={450000000n} />
        </strong>
        <TokenMark chainId={5042002} symbol="USDC" />
        <span className={styles.payButton}>Pay</span>
      </div>
    </div>
  );
}

export function CheckoutVisual() {
  return (
    <div className={styles.stack}>
      <pre data-theme="dark" className={styles.code}>
        <span className={styles.codeMuted}>POST /v1/profiles/:profileId/checkout-sessions</span>
        {"\n"}
        {"{\n"}
        {'  "storeId": '}
        <span className={styles.codeString}>"store_8f2"</span>
        {",\n"}
        {'  "amountUsd": '}
        <span className={styles.codeString}>"89.00"</span>
        {",\n"}
        {'  "reference": '}
        <span className={styles.codeString}>"order-1042"</span>
        {"\n}\n\n"}
        <span className={styles.codeMuted}>201 Created</span>
        {"\n"}
        {'{ "status": '}
        <span className={styles.codeString}>"open"</span>
        {', "payment": { "hostedUrl": … } }'}
      </pre>
      <div className={`${styles.float} ${styles.floatBottom}`}>
        <span className={styles.kicker}>order-1042</span>
        <strong className={styles.checkoutAmount}>
          <Money baseUnits={89000000n} decimals={6} token="OUSD" fractionDigits={2} />
        </strong>
        <TokenMark chainId={42431} symbol="OUSD" />
      </div>
    </div>
  );
}

export function StatusVisual() {
  return (
    <div className={styles.stack}>
      <div className={styles.sheet}>
        <div className={styles.sheetTop}>
          <strong>{example.invoice}</strong>
          <StatusPill status={PAYMENT_STATUS.settled} />
        </div>
        <strong className={styles.checkoutAmount}>
          <ExampleAmount />
        </strong>
        <div className={styles.timeline}>
          <PaymentTimeline
            label="Example payment steps"
            steps={[
              { label: "Detected", state: STEP_STATES.complete },
              { label: "Confirmed", state: STEP_STATES.complete },
              { label: "In wallet", state: STEP_STATES.complete },
            ]}
          />
        </div>
      </div>
      <pre data-theme="dark" className={`${styles.code} ${styles.webhook}`}>
        <span className={styles.codeMuted}>POST your-server.example/webhooks</span>
        {"\nwebhook-signature: …\n\n"}
        {'{ "type": '}
        <span className={styles.codeString}>"invoice.paid"</span>
        {', "livemode": false }'}
      </pre>
    </div>
  );
}
