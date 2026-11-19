/** Which form shows the next ask in place of its buttons; else its provider's dialog does. */
export interface Claim<Scope> {
  claim: (scope: Scope) => void;
  release: (scope: Scope) => void;
  claimed: () => Scope | null;
}

export function createClaim<Scope>(): Claim<Scope> {
  let claimed: Scope | null = null;
  return {
    claim: (scope) => {
      claimed = scope;
    },
    release: (scope) => {
      if (claimed === scope) claimed = null;
    },
    claimed: () => claimed,
  };
}
