import { buttonClasses } from "@forwend/ui-web";
import { ArrowRight, BookOpen, ChevronDown, Code2, FileText } from "lucide-react";
import Link from "next/link";
import { docsPath } from "@/shared/config/docs-routes";
import { DOCS, LEGACY_DOCS_ANCHORS } from "./constants/docs-content";
import styles from "./docs.module.css";
import { DocsLegacyLinks } from "./docs-legacy-links";

export function DocsHome() {
  return (
    <>
      <header className={styles.intro}>
        <h1>{DOCS.heading}</h1>
        <p>Accept a payment. Understand its status. Connect it to your business.</p>
      </header>
      <div className={styles.testNotice}>
        <span className={styles.testMark} aria-hidden="true" />
        <p>
          <strong>Try it in Developer mode first.</strong> Turn it on in a profile’s settings to use
          test networks and test tokens before real money.{" "}
          <Link href={docsPath("start/test-mode")}>How Developer mode works</Link>
        </p>
      </div>
      <section className={styles.quickstart} aria-labelledby="quickstart-title">
        <div>
          <BookOpen aria-hidden className="size-6" />
          <h2 id="quickstart-title">One payment, from start to finish.</h2>
          <p>
            Prepare your account, create a checkout on your server, and verify your first test
            payment.
          </p>
          <Link href={docsPath("start/first-test-payment")} className={buttonClasses()}>
            Start the quickstart <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>
        <ol>
          <li>
            <span>01</span>Set up your test key
          </li>
          <li>
            <span>02</span>Create a checkout
          </li>
          <li>
            <span>03</span>Pay and verify
          </li>
        </ol>
      </section>
      <section className={styles.homeSection} aria-labelledby="choose-title">
        <h2 id="choose-title">What are you building?</h2>
        <div className={styles.paths}>
          <div>
            <FileText aria-hidden className="size-5" />
            <h3>Collect without code</h3>
            <p>Invoice a client or share a link. Start from the app, with no API setup.</p>
            <Link href={docsPath("collect/invoices")}>
              Invoices <ArrowRight aria-hidden className="size-4" />
            </Link>
            <Link href={docsPath("collect/payment-links")}>
              Payment links <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
          <div>
            <Code2 aria-hidden className="size-5" />
            <h3>Connect your checkout</h3>
            <p>Create a payment for an order. Keep its price and fulfillment on your server.</p>
            <Link href={docsPath("collect/hosted-checkout")}>
              Hosted checkout <ArrowRight aria-hidden className="size-4" />
            </Link>
            <Link href={docsPath("collect/embedded-checkout")}>
              Embedded checkout <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </div>
      </section>
      <section className={styles.homeSection} aria-labelledby="reference-title">
        <h2 id="reference-title">Go straight to the details</h2>
        <div className={styles.referenceLinks}>
          {[
            {
              title: "API reference",
              slug: "api/checkout-sessions",
              description: "Operations, fields and responses",
            },
            {
              title: "Payment status",
              slug: "integrate/payment-status",
              description: "Detection, confirmation and settlement",
            },
            {
              title: "Webhook verification",
              slug: "integrate/webhooks",
              description: "Signatures, retries and duplicate events",
            },
            {
              title: "Networks and tokens",
              slug: "reference/networks",
              description: "Exact test pairs and availability",
            },
          ].map((item) => (
            <Link href={docsPath(item.slug)} key={item.slug}>
              <span>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </span>
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          ))}
        </div>
      </section>
      <details className={styles.legacyTopics}>
        <summary>
          Looking for a previous topic link?
          <ChevronDown aria-hidden className="size-4" />
        </summary>
        <div>
          {Object.entries(LEGACY_DOCS_ANCHORS).map(([id, target]) => (
            <Link id={id} key={id} href={docsPath(target.slug, target.heading)}>
              {id.replaceAll("-", " ")} <ArrowRight aria-hidden className="size-3" />
            </Link>
          ))}
        </div>
      </details>
      <DocsLegacyLinks />
    </>
  );
}
