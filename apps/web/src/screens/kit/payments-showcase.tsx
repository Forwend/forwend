import {
  ACTIVITY_DIRECTIONS,
  ActivityRow,
  Address,
  Money,
  NetworkWarning,
  PAYMENT_STATUSES,
  type PaymentStatus,
  PaymentTimeline,
  QrCode,
  ReceiveAddress,
  STEP_STATES,
  StatTile,
  StatusPill,
  TokenChip,
} from "@forwend/ui-web";
import { KitGroup } from "@/screens/kit/kit-section";
import { SAMPLE_INVOICE } from "@/shared/examples/sample-invoice";

const STATUSES = Object.keys(PAYMENT_STATUSES) as PaymentStatus[];

const SAMPLE_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

export function PaymentsShowcase() {
  return (
    <div className="flex flex-col gap-10">
      <p className="text-sm text-subtle">All amounts, addresses and names below are sample data.</p>
      <KitGroup title="Money">
        <Money
          baseUnits={SAMPLE_INVOICE.baseUnits}
          decimals={SAMPLE_INVOICE.decimals}
          token="USDC"
          className="text-amount-lg"
        />
        <Money baseUnits={1234560000n} decimals={6} token="USDC" className="text-amount" />
        <Money baseUnits={980000n} decimals={6} token="USDT" />
      </KitGroup>
      <KitGroup title="Token and network">
        <TokenChip token="USDC" network="Base" />
        <TokenChip token="USDT" network="Arbitrum" />
      </KitGroup>
      <KitGroup title="Address">
        <Address
          address={SAMPLE_ADDRESS}
          explorerHref={`https://basescan.org/address/${SAMPLE_ADDRESS}`}
        />
      </KitGroup>
      <KitGroup title="Receive address: full, grouped, with copy">
        <div className="w-full max-w-xs">
          <ReceiveAddress address={SAMPLE_ADDRESS} />
        </div>
      </KitGroup>
      <KitGroup title="QR code and network warning">
        <QrCode
          value={SAMPLE_ADDRESS}
          label="QR code for the sample deposit address"
          className="w-36"
        />
        <div className="max-w-md">
          <NetworkWarning token="USDC" network="Base" />
        </div>
      </KitGroup>
      <KitGroup title="Payment status">
        {STATUSES.map((status) => (
          <StatusPill key={status} status={status} />
        ))}
      </KitGroup>
      <KitGroup title="Payment timeline">
        <div className="grid w-full gap-8 md:grid-cols-2">
          <PaymentTimeline
            label="Payment progress, confirming"
            steps={[
              { label: "Detected", state: STEP_STATES.complete, detail: "12:04" },
              { label: "Confirming", state: STEP_STATES.current, detail: "8 of 12" },
              { label: "Paid", state: STEP_STATES.upcoming },
              { label: "Settled", state: STEP_STATES.upcoming },
            ]}
          />
          <PaymentTimeline
            label="Payment progress, settled"
            steps={[
              { label: "Detected", state: STEP_STATES.complete },
              { label: "Confirming", state: STEP_STATES.complete },
              { label: "Paid", state: STEP_STATES.complete },
              { label: "Settled", state: STEP_STATES.current, detail: "0x8f3a…c21d" },
            ]}
          />
        </div>
      </KitGroup>
      <KitGroup title="Stat tiles">
        <div className="grid w-full gap-4 sm:grid-cols-3">
          <StatTile
            label="Available"
            value={<Money baseUnits={4210500000n} decimals={6} token="USDC" />}
            note="On Base"
          />
          <StatTile
            label="Incoming"
            value={<Money baseUnits={1250000000n} decimals={6} token="USDC" />}
            note="1 invoice confirming"
          />
          <StatTile
            label="Held for refunds"
            value={<Money baseUnits={25000000n} decimals={6} token="USDC" />}
            note="Excess on FW-0039"
          />
        </div>
      </KitGroup>
      <KitGroup title="Activity">
        <div className="w-full max-w-2xl divide-y divide-line rounded-lg border border-line bg-surface px-4">
          <ActivityRow
            title="Brightline Studio"
            detail="Invoice FW-0042 · Base"
            direction={ACTIVITY_DIRECTIONS.incoming}
            amount={{ baseUnits: 1250000000n, decimals: 6, token: "USDC" }}
            status="settled"
          />
          <ActivityRow
            title="North Pier Coffee"
            detail="Invoice FW-0041 · Base"
            direction={ACTIVITY_DIRECTIONS.incoming}
            amount={{ baseUnits: 300000000n, decimals: 6, token: "USDC" }}
            status="partiallyPaid"
          />
          <ActivityRow
            title="Invoice FW-0043"
            detail="Waiting for payment · Base"
            direction={ACTIVITY_DIRECTIONS.request}
            amount={{ baseUnits: 800000000n, decimals: 6, token: "USDC" }}
            status="open"
          />
          <ActivityRow
            title="Withdrawal to bank"
            detail="EUR · SEPA"
            direction={ACTIVITY_DIRECTIONS.outgoing}
            amount={{ baseUnits: 500000000n, decimals: 6, token: "USDC" }}
            status="confirming"
          />
        </div>
      </KitGroup>
    </div>
  );
}
