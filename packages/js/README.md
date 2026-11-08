# @forwend/js

Forwend checkout in the browser, with no dependencies and no script loaded from Forwend.

```sh
npm install @forwend/js
```

Your server creates a checkout with the `forwend` package or the API, then gives `session.payment.payToken` to the page.

```ts
import { mountCheckout, payUrl } from "@forwend/js";

// A pay button: a plain link to the hosted checkout.
payLink.href = payUrl(payToken);

// Or the checkout in your page: "full", or "element" beside your own order summary.
const checkout = mountCheckout(document.getElementById("checkout")!, {
  payToken,
  layout: "element",
  onStatus: ({ paymentStatus }) => {
    if (paymentStatus === "paid") showThanks();
  },
  onLoadError: () => location.assign(payUrl(payToken)),
});
// When the page no longer needs it: checkout.destroy();
```

- Add your page's origin to the store's allowed origins. No other site can frame its checkout.
- The frame starts at a reserved height, then fits the checkout as it changes.
- `theme` is `light` or `dark`. Without it the checkout follows the visitor's system theme, so set it when your page has one.
- `baseUrl` must be https, or http on localhost while you develop.
- Events are hints for your page. Fulfil the order from the `invoice.paid` webhook, never from them.
- If your page sends a Content-Security-Policy, allow `frame-src https://forwend.com`.
- `onLoadError` runs when no checkout appears within 15 seconds, as when the origin is not allowed.

A checkout takes real money on mainnets in live mode, and testnet tokens in test mode: the key that made it decides.
Docs: https://forwend.com/docs
