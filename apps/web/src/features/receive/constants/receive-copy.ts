export const RECEIVE_COPY = {
  searchTokens: "Search tokens",
  searchNetworks: "Search networks",
  receive: "Receive",
  token: "Token",
  network: "Network",
  networks: (n: number) => (n === 1 ? "1 network" : `${n} networks`),
  change: "Change",
  changeLabel: "Change token and network",
  receiveQrLabel: "QR code of this profile's receive address",
  receiveFailed:
    "We could not load which network and token this address takes, so it stays hidden.",
  receiveNoTokens: "No networks are enabled yet, so there is nothing to receive.",
  minimum: "Minimum deposit",
  minimumAmount: "0.10 USD",
  minimumTip:
    "Smaller transfers aren't listed, but they stay in your wallet. A deposit shows once its network finalizes it.",
  minimumLabel: "About the minimum deposit",
  yourAddress: (network: string) => `Your ${network} address`,
  noWallet: "This profile's wallet is not ready yet. Reload the page to try again.",
} as const;
