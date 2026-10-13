export const RECEIVE_COPY = {
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
  receiveNote: "Money sent here shows in the balance once the network has finalized it.",
  yourAddress: (network: string) => `Your ${network} address`,
  noWallet: "This profile's wallet is not ready yet. Reload the page to try again.",
  retry: "Try again",
} as const;
