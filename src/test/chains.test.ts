import { describe, expect, it } from "vitest";

import {
  CHAIN_OPTIONS,
  dedupeCollections,
  detectWalletKind,
  isMintingOrUpcoming,
  normalizeWallet,
  splitOpenSeaEligibleStages,
  withOpenSeaEligibility,
} from "@/lib/chains";

describe("supported network wallet handling", () => {
  it("includes the requested OpenSea networks", () => {
    expect(CHAIN_OPTIONS.map((chain) => chain.value)).toEqual([
      "ethereum",
      "base",
      "robinhood",
      "solana",
    ]);
  });

  it("recognizes EVM and Solana public addresses", () => {
    expect(detectWalletKind("0x4d7773a982314c8AFcaf5dFec167C4161356031a")).toBe("evm");
    expect(detectWalletKind("11111111111111111111111111111111")).toBe("solana");
    expect(detectWalletKind("not-a-wallet")).toBeNull();
  });

  it("normalizes EVM addresses without changing case-sensitive Solana addresses", () => {
    expect(normalizeWallet("0xAbCd000000000000000000000000000000000000")).toBe(
      "0xabcd000000000000000000000000000000000000",
    );
    const solanaAddress = "AbCdEf123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    expect(normalizeWallet(solanaAddress)).toBe(solanaAddress);
  });

  it("deduplicates the same collection across sources and slug casing", () => {
    const first = {
      key: "manual:1",
      chain: "ethereum",
      opensea_slug: "project-drop",
    };
    const duplicateSlug = {
      key: "opensea:project",
      chain: "Ethereum",
      opensea_slug: "PROJECT-DROP",
    };
    const duplicateProject = {
      key: "opensea:alias",
      chain: "ethereum",
      opensea_slug: "project-drop-alias",
    };
    const differentProject = {
      key: "opensea:other",
      chain: "ethereum",
      opensea_slug: "another-project-drop",
    };
    const anotherChain = {
      key: "opensea:base",
      chain: "base",
      opensea_slug: "project-drop",
    };
    const noSlug = {
      key: "manual:2",
      chain: "ethereum",
      opensea_slug: null,
    };

    expect(
      dedupeCollections([
        first,
        duplicateSlug,
        duplicateProject,
        differentProject,
        anotherChain,
        noSlug,
      ]),
    ).toEqual([first, duplicateProject, differentProject, anotherChain, noSlug]);
  });

  it("only keeps drops that are live or have a future mint stage", () => {
    const now = Date.parse("2026-11-04T12:00:00.000Z");
    expect(isMintingOrUpcoming(true, null, now)).toBe(true);
    expect(isMintingOrUpcoming(false, "2026-11-05T12:00:00.000Z", now)).toBe(true);
    expect(isMintingOrUpcoming(false, "2026-11-03T12:00:00.000Z", now)).toBe(false);
    expect(isMintingOrUpcoming(false, null, now)).toBe(false);
  });

  it("does not treat public-phase eligibility as whitelist eligibility", () => {
    const result = splitOpenSeaEligibleStages([
      { stage_type: "public_sale", label: "Public Sale", is_eligible: true },
      { stage_type: "allowlist", label: "Allowlist", is_eligible: false },
    ]);

    expect(result.publicStages.map((stage) => stage.label)).toEqual(["Public Sale"]);
    expect(result.whitelistStages).toEqual([]);
  });

  it("reports eligible private phases separately from the public phase", () => {
    const result = splitOpenSeaEligibleStages([
      { stage_type: "public_sale", label: "Public Sale", is_eligible: true },
      { stage_type: "allowlist", label: "Founders Allowlist", is_eligible: true },
      { stage_type: "presale", label: "Presale", is_eligible: false },
    ]);

    expect(result.publicStages.map((stage) => stage.label)).toEqual(["Public Sale"]);
    expect(result.whitelistStages.map((stage) => stage.label)).toEqual(["Founders Allowlist"]);
  });

  it("does not classify a phase without a type as whitelist eligibility", () => {
    const result = splitOpenSeaEligibleStages([
      { stage_type: null, label: "Unnamed phase", is_eligible: true },
    ]);

    expect(result.unknownStages.map((stage) => stage.label)).toEqual(["Unnamed phase"]);
    expect(result.whitelistStages).toEqual([]);
  });

  it("stores public-only OpenSea eligibility as public and never as whitelist", () => {
    const item = {
      key: "os:example",
      name: "Example",
      x_handle: null,
      image: null,
      chain: "ethereum",
      source: "opensea" as const,
      source_url: null,
      checked_at: "2026-11-04T12:00:00.000Z",
      status: "sign_in" as const,
      eligibility_type: "whitelist" as const,
      detail: "Sign in required",
      mint_url: null,
      start_time: null,
      price: null,
      opensea_slug: "example",
    };

    const result = withOpenSeaEligibility(item, {
      whitelistStages: [],
      publicStages: ["Public Sale"],
      unknownStages: [],
    });

    expect(result.status).toBe("eligible");
    expect(result.eligibility_type).toBe("public");
    expect(result.detail).toContain("No whitelist eligibility was confirmed");
    expect(result.eligibility_verified).toBe(true);
  });
});
