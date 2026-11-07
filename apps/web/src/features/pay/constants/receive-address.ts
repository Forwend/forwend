// From packages/contracts/deployments.json, built in and never read from the API: a new factory needs a new build.
// New invoices use the newest factory; an invoice keeps the one it was made with (apps/backend/internal/address.Known).
export const FACTORY = "f93da73f1308a9b34aab78bf6d84f0bacc600dd2";
export const IMPLEMENTATION = "26b7db220af2da25b960e7e5bccf80a708ae630f";
export const KNOWN_FACTORIES: Readonly<Record<string, string>> = {
  [FACTORY]: IMPLEMENTATION,
  ece745390524e4d0b05d26f56af7f1d38fdb7546: "322f6c8daf0a8bd7cf16eb62d0a04700eea4b639", // v1
};
