import { BrandIcon, buttonClasses, LogoMark, Tabs } from "@forwend/ui-web";
import { Check, Code2, FileText, Link2, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { APP_ROUTES } from "@/shared/config/routes";
import styles from "../landing.module.css";

function InvoiceSample() {
  return (
    <div className={styles.invoicePreview}>
      <div className={styles.previewHeading}>
        <span className={styles.previewBrand}>
          <LogoMark className="size-5" />
          Studio North
        </span>
        <span className={styles.sample}>Sample invoice</span>
      </div>
      <div className={styles.invoiceTitle}>
        <div>
          <span className={styles.quiet}>Invoice #0012</span>
          <h3>A fresh perspective.</h3>
        </div>
        <span className={styles.paidLabel}>
          <Check aria-hidden className="size-3" />
          Paid
        </span>
      </div>
      <dl className={styles.invoiceParties}>
        <div>
          <dt>From</dt>
          <dd>Studio North</dd>
        </div>
        <div>
          <dt>Billed to</dt>
          <dd>Alex Morgan</dd>
        </div>
      </dl>
      <div className={styles.invoiceItem}>
        <span>Brand identity & design</span>
        <span>1,250.00 USDC</span>
      </div>
      <div className={styles.invoiceTotal}>
        <span>Total</span>
        <strong>
          1,250.00{" "}
          <small className={styles.assetLabel}>
            <BrandIcon name="usdc" className="size-4" /> USDC
          </small>
        </strong>
      </div>
      <div className={styles.invoicePaid}>
        <Check aria-hidden className="size-4" />
        <span>Paid. One less thing on your mind.</span>
      </div>
    </div>
  );
}

function LinkSample() {
  return (
    <div className={styles.linkPreview}>
      <div className={styles.previewHeading}>
        <Link2 aria-hidden className="size-5" />
        <span className={styles.sample}>Sample payment link</span>
      </div>
      <div className={styles.linkPreviewBody}>
        <span className={styles.studioAvatar}>N</span>
        <h3>
          A little advice.
          <br />A big step forward.
        </h3>
        <p>Design consultation · Studio North</p>
        <strong>
          150.00{" "}
          <small className={styles.assetLabel}>
            <BrandIcon name="usdc" className="size-4" /> USDC
          </small>
        </strong>
      </div>
      <div className={styles.sampleUrl}>
        <span>forwend.com/l/studio-north</span>
        <Link2 aria-hidden className="size-4" />
      </div>
    </div>
  );
}

function CheckoutSample() {
  return (
    <div className={styles.checkoutPreview}>
      <div className={styles.previewHeading}>
        <LogoMark className="size-5" />
        <span className={styles.sample}>Sample checkout</span>
      </div>
      <p className={styles.quiet}>Pay Studio North</p>
      <h3>Make it yours.</h3>
      <p>Design template collection</p>
      <strong className={styles.checkoutAmount}>
        49.00 <small>USDC</small>
      </strong>
      <dl className={styles.checkoutDetails}>
        <div>
          <dt>Network</dt>
          <dd className={styles.assetLabel}>
            <BrandIcon name="base" className="size-4" /> Base
          </dd>
        </div>
        <div>
          <dt>Token</dt>
          <dd className={styles.assetLabel}>
            <BrandIcon name="usdc" className="size-4" /> USDC
          </dd>
        </div>
      </dl>
      <div className={styles.checkoutNote}>
        <Wallet aria-hidden className="size-5" />
        <p>
          Pay from your wallet.
          <br />
          <span>No Forwend account needed.</span>
        </p>
      </div>
    </div>
  );
}

export function PaymentWorkspace() {
  return (
    <section id="product" className={styles.product} aria-labelledby="product-title">
      <div className={styles.sectionIntro}>
        <h2 id="product-title" className={styles.sectionTitle}>
          Your work takes many forms.
          <br />
          <span>So should your payments.</span>
        </h2>
        <p>From your first client to your next big idea. One place for every way you get paid.</p>
      </div>
      <Tabs
        label="Ways to get paid"
        items={[
          {
            value: "invoices",
            label: "Invoices",
            icon: <FileText aria-hidden className="size-4" />,
            content: (
              <ProductPanel
                title="From sent to settled."
                description="Create a clear invoice, send it to your client, and follow the payment all the way to your wallet."
                details={[
                  "Your details. Your line items.",
                  "A simple payment page for your client.",
                  "A record of every payment.",
                ]}
              >
                <InvoiceSample />
              </ProductPanel>
            ),
          },
          {
            value: "links",
            label: "Payment links",
            icon: <Link2 aria-hidden className="size-4" />,
            content: (
              <ProductPanel
                title="A link goes a long way."
                description="Put a payment link wherever your work happens. In a message, on your website, or in your next email."
                details={[
                  "Create once. Share anywhere.",
                  "A clear amount and payment details.",
                  "Keep every payment in one place.",
                ]}
              >
                <LinkSample />
              </ProductPanel>
            ),
          },
          {
            value: "checkout",
            label: "Checkout",
            icon: <Code2 aria-hidden className="size-4" />,
            content: (
              <ProductPanel
                title="Your business. Open to more."
                description="Give customers a clear way to pay in stablecoins. Connect checkout to your site with the Forwend API."
                details={[
                  "A payment page for each order.",
                  "Clear network and token instructions.",
                  "Payment updates for your app.",
                ]}
              >
                <CheckoutSample />
              </ProductPanel>
            ),
          },
        ]}
      />
    </section>
  );
}

function ProductPanel({
  title,
  description,
  details,
  children,
}: {
  title: string;
  description: string;
  details: string[];
  children: ReactNode;
}) {
  return (
    <div className={styles.productPanel}>
      <div className={styles.productCopy}>
        <h3>{title}</h3>
        <p>{description}</p>
        <ul>
          {details.map((detail) => (
            <li key={detail}>
              <Check aria-hidden className="size-4" />
              {detail}
            </li>
          ))}
        </ul>
        <Link
          prefetch={false}
          href={APP_ROUTES.signIn}
          className={buttonClasses({ variant: "link" })}
        >
          Open Forwend
        </Link>
      </div>
      <div className={styles.previewStage}>{children}</div>
    </div>
  );
}

export function PaymentJourney() {
  return (
    <section id="how-it-works" className={styles.journey} aria-labelledby="journey-title">
      <div className={styles.journeyHeading}>
        <h2 id="journey-title" className={styles.sectionTitle}>
          Less chasing.
          <br />
          <span>More creating.</span>
        </h2>
        <p>
          A clear path from the work you do
          <br />
          to the money you receive.
        </p>
      </div>
      <ol className={styles.journeySteps}>
        <li>
          <div className={styles.stepVisual}>
            <FileText aria-hidden />
            <span className={styles.stepLine} />
          </div>
          <span className={styles.stepNumber}>01</span>
          <h3>Make it yours</h3>
          <p>Create an invoice or payment link. Add an amount and what it’s for.</p>
        </li>
        <li>
          <div className={styles.stepVisual}>
            <Link2 aria-hidden />
            <span className={styles.stepLine} />
          </div>
          <span className={styles.stepNumber}>02</span>
          <h3>Send it their way</h3>
          <p>Your client opens the link and pays from a wallet or exchange. No account needed.</p>
        </li>
        <li>
          <div className={styles.stepVisual}>
            <Wallet aria-hidden />
            <span className={styles.stepLine} />
          </div>
          <span className={styles.stepNumber}>03</span>
          <h3>Know where you stand</h3>
          <p>See when a payment arrives, confirms, and reaches your wallet. Every step is clear.</p>
        </li>
      </ol>
      <div className={styles.developerNote}>
        <Code2 aria-hidden className="size-5" />
        <p>
          Building something of your own?<span> Bring Forwend payments into your app.</span>
        </p>
        <Link prefetch={false} href={APP_ROUTES.docs}>
          Read the docs
        </Link>
      </div>
    </section>
  );
}
