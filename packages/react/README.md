# @forwend/react

Forwend checkout for React 18 and 19: `PayButton`, `Checkout` and `PaymentElement`. No script is loaded from Forwend.

```sh
npm install @forwend/react
```

Your server creates a checkout with the `forwend` package or the API, then gives `session.payment.payToken` to the page.

```tsx
import { Checkout, PayButton, PaymentElement } from "@forwend/react";

// A plain link to the hosted checkout, styled by you.
<PayButton payToken={payToken} className="button" />

// The whole checkout in your page.
<Checkout payToken={payToken} theme="light" onLoadError={() => location.assign(`https://forwend.com/pay/${payToken}`)} />

// Its pay panel, beside your own order summary.
<PaymentElement
  payToken={payToken}
  theme="dark"
  onStatus={({ paymentStatus }) => paymentStatus === "paid" && showThanks()}
/>
```

- Add your page's origin to the store's allowed origins. No other site can frame its checkout.
- The frame starts at a reserved height, then fits the checkout as it changes.
- `theme` is `light` or `dark`. Without it the checkout follows the visitor's system theme, so set it when your page has one.
- `baseUrl` must be https, or http on localhost while you develop.
- Events are hints for your page. Fulfil the order from the `invoice.paid` webhook, never from them.
- If your page sends a Content-Security-Policy, allow `frame-src https://forwend.com`.
- The components work in Next.js app routes: they are client components and render an empty box on the server.

A checkout takes real money on mainnets in live mode, and testnet tokens in test mode: the key that made it decides.
Docs: https://forwend.com/docs
