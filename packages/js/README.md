# @forwend/js

Forwend checkout in the browser, with no dependencies and no script loaded from Forwend.

```sh
npm install @forwend/js
```

Your server creates a checkout with the `forwend` package or the API, then gives its pay token to the page.

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
- Events are hints for your page. Fulfil the order from the `invoice.paid` webhook, never from them.
- If your page sends a Content-Security-Policy, allow `frame-src https://forwend.com`.
- `onLoadError` runs when no checkout appears within 15 seconds, as when the origin is not allowed.

Every network is a testnet for now, so every checkout is in test mode. Docs: https://forwend.com/docs
