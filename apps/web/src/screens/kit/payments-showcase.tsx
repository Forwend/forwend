import {
  ACTIVITY_DIRECTIONS,
  ActivityRow,
  Address,
  BigAmount,
  Card,
  DetailList,
  DetailRow,
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
  Stepper,
  TIMELINE_STATES,
  Timeline,
  TokenChip,
  WALLET_STATES,
  type WalletState,
  WalletStateLabel,
} from "@forwend/ui-web";
import { ExternalLink } from "lucide-react";
import { KitGroup } from "@/screens/kit/kit-section";
import { SAMPLE_INVOICE } from "@/shared/examples/sample-invoice";

const STATUSES = Object.keys(PAYMENT_STATUSES) as PaymentStatus[];
const WALLET = Object.keys(WALLET_STATES) as WalletState[];

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
        <Money baseUnits={0n} decimals={6} token="USDC" />
        <Money baseUnits={-5000000n} decimals={6} token="USDC" />
        <div className="w-40">
          <Money baseUnits={123456789012123456n} decimals={6} token="USDC" />
        </div>
        <Money baseUnits={1234567890123456789n} decimals={18} token="OUSD" />
      </KitGroup>
      <KitGroup title="Big amount: whole part ink, cents subtle; no cents; a long figure">
        <BigAmount value="18,412.09" className="text-5xl" />
        <BigAmount value="240" className="text-3xl" />
        <BigAmount value="1,234,567,890.50" className="text-3xl" />
      </KitGroup>
      <KitGroup title="Card: title, description and action; body only">
        <div className="grid w-full gap-4 md:grid-cols-2">
          <Card
            id="kit-card"
            title="Pending payments"
            description="3 payments"
            action={<span className="text-xs text-muted">View all</span>}
          >
            <p className="text-sm text-muted">The card body: rows, a figure or a chart.</p>
          </Card>
          <Card>
            <p className="text-sm text-muted">A card with no header.</p>
          </Card>
        </div>
      </KitGroup>
      <KitGroup title="Token and network">
        <TokenChip token="USDC" network="Base" />
        <TokenChip token="USDT" network="Arbitrum" />
        <TokenChip token="PYUSD" network="Base" />
        <div className="w-48">
          <TokenChip token="USDC" network="Arbitrum Sepolia Testnet" />
        </div>
      </KitGroup>
      <KitGroup title="Address">
        <Address
          address={SAMPLE_ADDRESS}
          explorerHref={`https://basescan.org/address/${SAMPLE_ADDRESS}`}
        />
        <Address address={SAMPLE_ADDRESS} />
      </KitGroup>
      <KitGroup title="Receive address: full, start and end marked, with copy">
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
        <div className="flex max-w-md flex-col gap-3">
          <NetworkWarning token="USDC" network="Base" />
          <NetworkWarning token="USDC" network="Arbitrum" lookalike="USDC.e" />
        </div>
      </KitGroup>
      <KitGroup title="Payment status">
        {STATUSES.map((status) => (
          <StatusPill key={status} status={status} />
        ))}
      </KitGroup>
      <KitGroup title="Payment status, quiet: Confirmed as a dot in long lists">
        <StatusPill quiet status="confirmed" />
        <StatusPill quiet status="confirming" />
      </KitGroup>
      <KitGroup title="Wallet transfer: no transfer yet, pending, in wallet, delayed, needs review">
        {WALLET.map((state) => (
          <WalletStateLabel key={state} state={state} />
        ))}
      </KitGroup>
      <KitGroup title="Detail list: statement rows, a stacked note">
        <div className="fw-panel w-full max-w-md">
          <DetailList>
            <DetailRow term="Order reference">order-1042</DetailRow>
            <DetailRow term="Customer">
              Mara Ilić
              <span className="block text-muted">mara@example.com</span>
            </DetailRow>
            <DetailRow term="Checkout closes">Oct 30, 2026, 5:00 PM</DetailRow>
            <DetailRow term="Note" stacked>
              Thanks for the order. The second box ships on Monday.
            </DetailRow>
          </DetailList>
        </div>
      </KitGroup>
      <KitGroup title="Stepper">
        <div className="flex w-full flex-col gap-6">
          {[
            { current: 0, free: false },
            { current: 2, free: false },
            { current: 3, free: false },
            { current: 1, free: true },
          ].map(({ current, free }) => (
            <Stepper
              key={`${current}:${free}`}
              label={free ? "Editing, every step open" : `Steps, at ${current + 1} of 4`}
              current={current}
              free={free}
              steps={[
                { id: "customer", label: "Customer" },
                { id: "items", label: "Items" },
                { id: "details", label: "Details" },
                { id: "review", label: "Review" },
              ]}
            />
          ))}
        </div>
      </KitGroup>
      <KitGroup title="Timeline">
        <div className="w-full max-w-sm">
          <Timeline
            label="Payment timeline"
            entries={[
              {
                id: "created",
                title: "Created",
                state: TIMELINE_STATES.done,
                time: "Oct 28, 9:46 PM",
                chips: [{ label: "From", value: "Payment link" }],
              },
              {
                id: "detected",
                title: "Payment detected",
                state: TIMELINE_STATES.done,
                time: "Oct 28, 9:46 PM",
                chips: [
                  { label: "Network", value: "Base Sepolia" },
                  { label: "Tx", value: "0xf9a5…0b62" },
                ],
              },
              { id: "paid", title: "Paid", state: TIMELINE_STATES.current },
              { id: "wallet", title: "In your wallet", state: TIMELINE_STATES.upcoming },
            ]}
          />
        </div>
      </KitGroup>
      <KitGroup title="Payment timeline">
        <div className="grid w-full gap-8 md:grid-cols-2">
          <PaymentTimeline
            label="Payment progress, confirming"
            steps={[
              { label: "Detected", state: STEP_STATES.complete, detail: "12:04" },
              {
                label: "Confirming",
                state: STEP_STATES.current,
                detail: "8 of 12",
                progress: 0.66,
              },
              { label: "Paid", state: STEP_STATES.upcoming },
              { label: "Settled", state: STEP_STATES.upcoming },
            ]}
          />
          <PaymentTimeline
            label="Payment progress, confirming with no known share"
            steps={[
              { label: "Waiting", state: STEP_STATES.complete },
              { label: "Detected", state: STEP_STATES.complete },
              { label: "Confirming", state: STEP_STATES.current, progress: null },
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
          <PaymentTimeline
            label="Payment progress, not started"
            steps={[
              { label: "Detected", state: STEP_STATES.upcoming },
              { label: "Confirming", state: STEP_STATES.upcoming },
              { label: "Paid", state: STEP_STATES.upcoming },
              { label: "Settled", state: STEP_STATES.upcoming },
            ]}
          />
          <div className="w-80">
            <PaymentTimeline
              label="Payment progress on a phone, stacked"
              steps={[
                { label: "Waiting", state: STEP_STATES.complete },
                { label: "Detected", state: STEP_STATES.complete, detail: "12:04" },
                { label: "Confirming", state: STEP_STATES.current, progress: null },
                { label: "Paid", state: STEP_STATES.upcoming },
                { label: "Settled", state: STEP_STATES.upcoming },
              ]}
            />
          </div>
          <PaymentTimeline
            label="Payment progress, confirming from zero"
            steps={[
              { label: "Detected", state: STEP_STATES.complete, detail: SAMPLE_ADDRESS },
              {
                label: "Confirming",
                state: STEP_STATES.current,
                detail: "0 of 12",
                progress: 0,
              },
              { label: "Paid", state: STEP_STATES.upcoming },
              { label: "Settled", state: STEP_STATES.upcoming },
            ]}
          />
        </div>
      </KitGroup>
      <KitGroup title="Stat tiles">
        <div className="grid w-full gap-4 sm:grid-cols-3">
          <StatTile
            label="In wallet"
            value={<Money baseUnits={4210500000n} decimals={6} token="USDC" />}
            note="On Base"
          />
          <StatTile
            label="Moving to wallet"
            value={<Money baseUnits={1250000000n} decimals={6} token="USDC" />}
            note="1 payment"
          />
          <StatTile
            label="On hold"
            value={<Money baseUnits={25000000n} decimals={6} token="USDC" />}
            note="Extra on INV-0039"
          />
        </div>
      </KitGroup>
      <KitGroup title="Activity">
        <div className="w-full max-w-2xl divide-y divide-line rounded-lg border border-line bg-surface px-4">
          <ActivityRow
            title="Brightline Studio"
            detail="Invoice INV-0042 · Base"
            direction={ACTIVITY_DIRECTIONS.incoming}
            amount={{ baseUnits: 1250000000n, decimals: 6, token: "USDC" }}
            status="settled"
            action={
              <a
                href={`https://basescan.org/tx/0x${"8f3a".repeat(16)}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View transaction on Basescan"
                className="rounded-sm p-1 text-muted hover:bg-surface-2 hover:text-ink"
              >
                <ExternalLink aria-hidden className="size-[var(--fw-icon-sm)]" />
              </a>
            }
          />
          <ActivityRow
            title="North Pier Coffee"
            detail="Invoice INV-0041 · Base"
            direction={ACTIVITY_DIRECTIONS.incoming}
            amount={{ baseUnits: 300000000n, decimals: 6, token: "USDC" }}
            status="partiallyPaid"
          />
          <ActivityRow
            title="Invoice INV-0043"
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
        <div className="w-full max-w-sm divide-y divide-line rounded-lg border border-line bg-surface px-4">
          <ActivityRow
            title="Aleksandra Wiśniewska-Kowalczyk Design Studio"
            detail="Invoice INV-0044 · Arbitrum Sepolia Testnet · 2 payments"
            direction={ACTIVITY_DIRECTIONS.incoming}
            amount={{ baseUnits: 123456789012123456n, decimals: 6, token: "USDC" }}
            status="expiredPartiallyPaid"
          />
          <ActivityRow
            title="Northwind Industries Holdings"
            detail="Invoice INV-0045 · Base"
            direction={ACTIVITY_DIRECTIONS.incoming}
            amount={{ baseUnits: 4999999n, decimals: 6, token: "USDC" }}
            status="detected"
          />
          <ActivityRow
            title="Refund to Jo"
            detail="Extra on INV-0039 · Base"
            direction={ACTIVITY_DIRECTIONS.outgoing}
            amount={{ baseUnits: -25000000n, decimals: 6, token: "USDC" }}
            status="refunded"
          />
          <ActivityRow
            title="Deposit"
            detail="Base"
            direction={ACTIVITY_DIRECTIONS.incoming}
            amount={{ baseUnits: 1500000000000000000n, decimals: 18, token: "OUSD" }}
            status="confirmed"
          />
        </div>
      </KitGroup>
    </div>
  );
}
