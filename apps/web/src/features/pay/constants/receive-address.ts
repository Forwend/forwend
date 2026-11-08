// From packages/contracts/deployments.json, the same on testnets and mainnets. Built in and never read from the API:
// a new factory needs a new build.
// New invoices use the newest factory; an invoice keeps the one it was made with (apps/backend/internal/address.Known).
export const FACTORY = "e917ce63865f8cf91a0038136e496b25ece2a54e"; // v2
export const IMPLEMENTATION = "81cda02e469083fd14a75583257d9b721ca76132";
// fees: the factory's terms end with the network and platform fees (v2 on, R-226).
export const KNOWN_FACTORIES: Readonly<Record<string, { implementation: string; fees: boolean }>> =
  {
    [FACTORY]: { implementation: IMPLEMENTATION, fees: true },
    f93da73f1308a9b34aab78bf6d84f0bacc600dd2: {
      implementation: "26b7db220af2da25b960e7e5bccf80a708ae630f",
      fees: false,
    }, // v1.1
    ece745390524e4d0b05d26f56af7f1d38fdb7546: {
      implementation: "322f6c8daf0a8bd7cf16eb62d0a04700eea4b639",
      fees: false,
    }, // v1
  };
