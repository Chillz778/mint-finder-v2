export type WalletKind = "evm" | "solana";

export const CHAIN_OPTIONS = [
  { value: "ethereum", label: "Ethereum", kind: "evm" as WalletKind },
  { value: "base", label: "Base", kind: "evm" as WalletKind },
  { value: "robinhood", label: "Robinhood Chain", kind: "evm" as WalletKind },
  { value: "solana", label: "Solana", kind: "solana" as WalletKind },
];

export const EVM_CHAINS = CHAIN_OPTIONS.filter((chain) => chain.kind === "evm").map(
  (chain) => chain.value,
);

export const RULE_OPTIONS = [
  { value: "public", label: "Public mint — anyone can mint" },
  { value: "allowlist", label: "Allowlist — wallets I upload" },
  { value: "holder", label: "Must hold an NFT from a collection" },
  { value: "opensea", label: "OpenSea drop — check with OpenSea sign-in" },
  { value: "check_site", label: "Check on the project's own site" },
];

export function chainKind(chain: string): WalletKind {
  return chain === "solana" ? "solana" : "evm";
}

export function chainLabel(chain: string) {
  return CHAIN_OPTIONS.find((c) => c.value === chain)?.label ?? chain;
}

export function isMintingOrUpcoming(
  isMinting: boolean,
  nextStartTime: string | null,
  now = Date.now(),
) {
  return isMinting || (nextStartTime != null && Date.parse(nextStartTime) > now);
}

export function detectWalletKind(address: string): WalletKind | null {
  const a = address.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return "evm";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return "solana";
  return null;
}

export function normalizeWallet(address: string) {
  const a = address.trim();
  return detectWalletKind(a) === "evm" ? a.toLowerCase() : a;
}

export function collectionIdentityKey(chain: string, slug: string) {
  return `${chain.trim().toLowerCase()}:${slug.trim().toLowerCase()}`;
}

export function dedupeCollections<
  T extends { key: string; chain: string; opensea_slug: string | null },
>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.opensea_slug) return true;
    const identity = collectionIdentityKey(item.chain, item.opensea_slug);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function parseXHandle(input: string): string | null {
  const s = input.trim();
  const m = s.match(/(?:x\.com|twitter\.com)\/(@?[A-Za-z0-9_]{1,15})/i);
  const h = m?.[1] ?? s;
  const clean = h.replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(clean)) return null;
  if (["home", "i", "intent", "search", "explore"].includes(clean.toLowerCase())) return null;
  return clean;
}

export type Status = "eligible" | "not_eligible" | "sign_in" | "check_site" | "unknown";
export type EligibilityType = "public" | "whitelist" | "holder" | "site";

export type OpenSeaEligibilityStage = {
  stage_type: string | null;
  label: string;
  is_eligible: boolean;
};

export function splitOpenSeaEligibleStages(stages: OpenSeaEligibilityStage[]) {
  const eligibleStages = stages.filter((stage) => stage.is_eligible);
  return {
    publicStages: eligibleStages.filter(
      (stage) => stage.stage_type?.toLowerCase() === "public_sale",
    ),
    whitelistStages: eligibleStages.filter(
      (stage) => stage.stage_type != null && stage.stage_type.toLowerCase() !== "public_sale",
    ),
    unknownStages: eligibleStages.filter((stage) => !stage.stage_type),
  };
}

export type ResultItem = {
  key: string;
  name: string;
  x_handle: string | null;
  image: string | null;
  chain: string;
  source: "opensea" | "manual";
  source_url: string | null;
  checked_at: string;
  status: Status;
  eligibility_type: EligibilityType;
  eligibility_verified?: boolean;
  verified_stages?: string[];
  detail: string;
  mint_url: string | null;
  start_time: string | null;
  price: string | null;
  opensea_slug: string | null;
};

export function buildSiweMessage(address: string, nonce: string, issuedAt: string) {
  return {
    domain: "opensea.io",
    address,
    statement:
      "Click to sign in and accept the Platform Terms of Service (https://opensea.io/tos) and Privacy Policy (https://opensea.io/privacy).",
    uri: "https://opensea.io",
    version: "1",
    chainId: "1",
    nonce,
    issuedAt,
    accountType: "Ethereum",
  };
}

export function siweText(m: ReturnType<typeof buildSiweMessage>) {
  return `${m.domain} wants you to sign in with your ${m.accountType} account:\n${m.address}\n\n${m.statement}\n\nURI: ${m.uri}\nVersion: ${m.version}\nChain ID: ${m.chainId}\nNonce: ${m.nonce}\nIssued At: ${m.issuedAt}`;
}
