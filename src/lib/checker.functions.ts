import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireAdminSession } from "./admin-auth.server";
import type { Database } from "@/integrations/supabase/types";
import {
  CHAIN_OPTIONS,
  collectionIdentityKey,
  dedupeCollections,
  detectWalletKind,
  isMintingOrUpcoming,
  normalizeWallet,
  parseXHandle,
  readDropSupply,
  splitOpenSeaEligibleStages,
  type ResultItem,
} from "./chains";

const OS = "https://api.opensea.io";
type JsonObject = Record<string, unknown>;

type OpenSeaStage = {
  stage_type: string | null;
  label: string | null;
  start_time: string | null;
  price: string | null;
};

type OpenSeaDrop = {
  collection_slug: string;
  collection_name: string;
  chain: string;
  image_url: string | null;
  opensea_url: string | null;
  is_minting: boolean;
  total_supply: string | null;
  max_supply: string | null;
  active_stage: OpenSeaStage | null;
  next_stage: OpenSeaStage | null;
};

const OPEN_SEA_DROP_TYPES = ["featured", "upcoming", "recently_minted"] as const;
const MAX_OPEN_SEA_DROP_PAGES = 5;
const MAX_OPEN_SEA_DROPS = 80;
const OPEN_SEA_PAGE_SIZE = 100;
const OPEN_SEA_COLLECTION_BATCH_SIZE = 50;

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asObjects(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.map(asObject).filter((item): item is JsonObject => item !== null)
    : [];
}

function stringField(object: JsonObject, key: string): string | null {
  const value = object[key];
  return typeof value === "string" ? value : null;
}

function parseStage(value: unknown): OpenSeaStage | null {
  const stage = asObject(value);
  if (!stage) return null;
  return {
    stage_type: stringField(stage, "stage_type"),
    label: stringField(stage, "label"),
    start_time: stringField(stage, "start_time"),
    price: stringField(stage, "price"),
  };
}

function parseDrop(value: unknown): OpenSeaDrop | null {
  const drop = asObject(value);
  const slug = drop && stringField(drop, "collection_slug");
  const name = drop && stringField(drop, "collection_name");
  const chain = drop && stringField(drop, "chain");
  if (!drop || !slug || !chain) return null;
  return {
    collection_slug: slug,
    collection_name: name ?? slug.replace(/[-_]/g, " "),
    chain,
    image_url: stringField(drop, "image_url"),
    opensea_url: stringField(drop, "opensea_url"),
    is_minting: drop["is_minting"] === true,
    total_supply: stringField(drop, "total_supply"),
    max_supply: stringField(drop, "max_supply"),
    active_stage: parseStage(drop["active_stage"]),
    next_stage: parseStage(drop["next_stage"]),
  };
}

function firstString(object: JsonObject, keys: string[]): string | null {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function publicDb() {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  const url = process.env["SUPABASE_URL"];
  if (!key || !url) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`)
          h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

async function osGet(path: string, extra: Record<string, string> = {}): Promise<JsonObject | null> {
  const key = process.env["OPENSEA_API_KEY"];
  if (!key) throw new Error("OpenSea key missing");
  const res = await fetch(OS + path, {
    headers: { "X-API-KEY": key, accept: "application/json", ...extra },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`OpenSea ${path} [${res.status}]: ${body.slice(0, 300)}`);
    return null;
  }
  return asObject(await res.json());
}

async function osPost(path: string, body: JsonObject): Promise<JsonObject | null> {
  const key = process.env["OPENSEA_API_KEY"];
  if (!key) throw new Error("OpenSea key missing");
  const res = await fetch(OS + path, {
    method: "POST",
    headers: {
      "X-API-KEY": key,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const responseBody = await res.text();
    console.error(`OpenSea ${path} [${res.status}]: ${responseBody.slice(0, 300)}`);
    return null;
  }
  return asObject(await res.json());
}

function weiToEth(wei: string | null | undefined) {
  if (wei == null) return null;
  try {
    const n = Number(BigInt(wei)) / 1e18;
    return n === 0 ? "Free" : `${n} ETH`;
  } catch {
    return null;
  }
}

type DropListScan = {
  type: (typeof OPEN_SEA_DROP_TYPES)[number];
  drops: Map<string, OpenSeaDrop>;
  cursor: string | null;
  pages: number;
  hadResponse: boolean;
  failed: boolean;
};

async function scanDropPage(scan: DropListScan, chains: string[]) {
  const params = new URLSearchParams({
    type: scan.type,
    limit: String(OPEN_SEA_PAGE_SIZE),
    chains: chains.join(","),
  });
  if (scan.cursor) params.set("cursor", scan.cursor);

  let page: JsonObject | null = null;
  try {
    page = await osGet(`/api/v2/drops?${params.toString()}`);
  } catch (error) {
    console.error(`OpenSea ${scan.type} drops request failed`, error);
  }
  scan.pages += 1;
  if (!page) {
    scan.failed = true;
    scan.cursor = null;
    return;
  }

  scan.hadResponse = true;
  for (const rawDrop of asObjects(page["drops"])) {
    const drop = parseDrop(rawDrop);
    const key = drop ? collectionIdentityKey(drop.chain, drop.collection_slug) : "";
    if (
      drop &&
      chains.includes(drop.chain) &&
      isMintingOrUpcoming(drop.is_minting, drop.next_stage?.start_time ?? null) &&
      !scan.drops.has(key)
    ) {
      scan.drops.set(key, drop);
    }
  }
  scan.cursor = stringField(page, "next");
}

function formatSupply(value: bigint) {
  return value.toLocaleString("en-US");
}

async function loadDropDetails(drop: OpenSeaDrop): Promise<OpenSeaDrop | null> {
  try {
    const details = await osGet(`/api/v2/drops/${encodeURIComponent(drop.collection_slug)}`);
    return details ? parseDrop(details) : null;
  } catch (error) {
    console.error(`OpenSea drop details failed for ${drop.collection_slug}`, error);
    return null;
  }
}

async function loadCollectionMetadata(drops: OpenSeaDrop[]) {
  const metadata = new Map<string, { x: string | null; site: string | null }>();
  for (let offset = 0; offset < drops.length; offset += OPEN_SEA_COLLECTION_BATCH_SIZE) {
    const batch = drops.slice(offset, offset + OPEN_SEA_COLLECTION_BATCH_SIZE);
    try {
      const response = await osPost("/api/v2/collections/batch", {
        slugs: batch.map((drop) => drop.collection_slug),
      });
      for (const collection of asObjects(response?.["collections"])) {
        const slug = stringField(collection, "collection");
        if (slug) {
          metadata.set(slug.toLowerCase(), {
            x: stringField(collection, "twitter_username"),
            site: stringField(collection, "project_url"),
          });
        }
      }
    } catch (error) {
      console.error("OpenSea collection metadata request failed", error);
    }
  }
  return metadata;
}

async function loadDrops(chains: string[]): Promise<{
  items: ResultItem[];
  warning: string | null;
}> {
  const scans: DropListScan[] = OPEN_SEA_DROP_TYPES.map((type) => ({
    type,
    drops: new Map(),
    cursor: null,
    pages: 0,
    hadResponse: false,
    failed: false,
  }));
  await Promise.all(scans.map((scan) => scanDropPage(scan, chains)));

  if (scans.every((scan) => !scan.hadResponse)) {
    throw new Error("OpenSea drop listings are unavailable");
  }

  const selectCandidates = () => {
    const candidates = new Map<string, OpenSeaDrop>();
    const orderedDrops = scans.map((scan) => [...scan.drops.entries()]);
    for (let index = 0; candidates.size < MAX_OPEN_SEA_DROPS; index += 1) {
      let foundAtIndex = false;
      for (const entries of orderedDrops) {
        const entry = entries[index];
        if (!entry) continue;
        foundAtIndex = true;
        if (!candidates.has(entry[0])) candidates.set(entry[0], entry[1]);
        if (candidates.size >= MAX_OPEN_SEA_DROPS) break;
      }
      if (!foundAtIndex) break;
    }
    return candidates;
  };
  while (
    selectCandidates().size < MAX_OPEN_SEA_DROPS &&
    scans.some((scan) => scan.cursor && scan.pages < MAX_OPEN_SEA_DROP_PAGES)
  ) {
    const remainingScans = scans.filter(
      (scan) => scan.cursor && scan.pages < MAX_OPEN_SEA_DROP_PAGES,
    );
    await Promise.all(remainingScans.map((scan) => scanDropPage(scan, chains)));
  }

  const candidates = selectCandidates();
  const summaries = [...candidates.values()];
  const details: OpenSeaDrop[] = [];
  for (let offset = 0; offset < summaries.length; offset += 10) {
    const batch = await Promise.all(summaries.slice(offset, offset + 10).map(loadDropDetails));
    for (const [index, detail] of batch.entries()) {
      const summary = summaries[offset + index];
      if (summary) details.push(detail ?? summary);
    }
  }

  const collectionMetadata = await loadCollectionMetadata(details);
  const checkedAt = new Date().toISOString();
  const items = dedupeCollections(
    details.flatMap((drop) => {
      const supply = readDropSupply(drop.total_supply, drop.max_supply);
      if (supply.status === "sold_out") return [];

      const stage = drop.is_minting ? drop.active_stage : drop.next_stage;
      if (!isMintingOrUpcoming(drop.is_minting, drop.next_stage?.start_time ?? null)) return [];

      const metadata = collectionMetadata.get(drop.collection_slug.toLowerCase());
      const isPublic = stage?.stage_type?.toLowerCase() === "public_sale";
      const hasStage = stage != null;
      const supplyVerified = supply.status === "available";
      const status: ResultItem["status"] = !hasStage
        ? "check_site"
        : !supplyVerified && isPublic
          ? "unknown"
          : isPublic
            ? "eligible"
            : "sign_in";
      const eligibilityType: ResultItem["eligibility_type"] = isPublic
        ? "public"
        : hasStage
          ? "whitelist"
          : "site";
      const stageName = stage?.label ?? (isPublic ? "Public stage" : "Restricted stage");
      let detail = "No active or upcoming stage was confirmed by OpenSea. Check the project site.";
      if (hasStage && !supplyVerified) {
        detail = `${stageName} appears in OpenSea's drop data, but Mint Finder couldn't confirm supply. Check OpenSea before relying on availability${isPublic ? "; this public stage is listed as open to every wallet, not as a wallet-specific check" : "."}`;
      } else if (hasStage && isPublic && supply.status === "available") {
        detail = `${stageName} — OpenSea lists this as open to every wallet, not as a wallet-specific eligibility check. OpenSea reports ${formatSupply(BigInt(supply.remaining!))} of ${formatSupply(BigInt(supply.max!))} items remaining.`;
      } else if (hasStage && supply.status === "available") {
        detail = `${stageName} is listed by OpenSea. OpenSea reports ${formatSupply(BigInt(supply.remaining!))} of ${formatSupply(BigInt(supply.max!))} items remaining. Sign in with OpenSea to check wallet eligibility for this phase.`;
      }

      return [
        {
          key: `os:${drop.collection_slug}`,
          name: drop.collection_name,
          x_handle: metadata?.x ?? null,
          image: drop.image_url,
          chain: drop.chain,
          source: "opensea",
          source_url: `https://opensea.io/collection/${encodeURIComponent(drop.collection_slug)}`,
          checked_at: checkedAt,
          status,
          eligibility_type: eligibilityType,
          eligibility_verified: false,
          supply_verified: supplyVerified,
          detail,
          mint_url: drop.opensea_url ?? metadata?.site ?? null,
          start_time: stage?.start_time ?? null,
          price: weiToEth(stage?.price),
          opensea_slug: drop.collection_slug,
        } satisfies ResultItem,
      ];
    }),
  );

  const failedTypes = scans.filter((scan) => !scan.hadResponse || scan.failed).length;
  const hitPageLimit = scans.some(
    (scan) => scan.cursor != null && scan.pages >= MAX_OPEN_SEA_DROP_PAGES,
  );
  const stoppedAtResultLimit =
    candidates.size >= MAX_OPEN_SEA_DROPS && scans.some((scan) => scan.cursor != null);
  const warning =
    failedTypes > 0 || hitPageLimit
      ? "OpenSea returned a partial drop listing. Some projects may be missing; verify the latest stage and availability on OpenSea."
      : stoppedAtResultLimit
        ? "OpenSea has more matching drops than this check displays. Some projects may be missing; verify the latest listings on OpenSea."
        : null;
  return { items, warning };
}

export const checkWallet = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ address: z.string().min(20).max(64) }).parse(d))
  .handler(async ({ data }) => {
    const kind = detectWalletKind(data.address);
    if (!kind)
      return {
        error: "That doesn't look like an Ethereum or Solana wallet address.",
        items: [] as ResultItem[],
        sourceWarning: null,
      };
    const wallet = normalizeWallet(data.address);
    const db = publicDb();
    const supportedChains = CHAIN_OPTIONS.filter((chain) => chain.kind === kind).map(
      (chain) => chain.value,
    );
    const [{ data: projects, error: projectsError }, { data: listed, error: allowlistError }] =
      await Promise.all([
        db.from("projects").select("*").order("created_at", { ascending: false }).limit(500),
        db.rpc("allowlisted_projects", { _wallet: data.address.trim() }),
      ]);
    if (projectsError) throw projectsError;
    if (allowlistError) throw allowlistError;
    const listedSet = new Set((listed as string[] | null) ?? []);

    const manual: ResultItem[] = await Promise.all(
      (projects ?? [])
        .filter((project) => supportedChains.includes(project.chain))
        .map(async (p) => {
          let status: ResultItem["status"] = "check_site";
          let eligibilityType: ResultItem["eligibility_type"] = "site";
          let detail = "Check your status on the project's mint site";
          if (p.rule === "public") {
            status = "eligible";
            eligibilityType = "public";
            detail =
              "The site owner lists this as a public mint. Verify the mint is still open on the project site.";
          } else if (p.rule === "allowlist") {
            status = listedSet.has(p.id) ? "eligible" : "not_eligible";
            eligibilityType = "whitelist";
            detail =
              status === "eligible"
                ? "Your wallet is on this project's whitelist"
                : "Your wallet is not on this project's whitelist";
          } else if (p.rule === "holder" && p.holder_contract) {
            eligibilityType = "holder";
            let r: JsonObject | null = null;
            try {
              r = await osGet(
                `/api/v2/chain/${encodeURIComponent(p.chain)}/account/${encodeURIComponent(wallet)}/nfts?collection=${encodeURIComponent(p.holder_contract)}&limit=1`,
              );
            } catch (error) {
              console.error(`OpenSea holder check failed for project ${p.id}`, error);
            }
            if (r == null) {
              status = "unknown";
              detail = "Couldn't check holdings right now";
            } else {
              const holds = asObjects(r["nfts"]).length > 0;
              status = holds ? "eligible" : "not_eligible";
              detail = holds
                ? `You hold an NFT from ${p.holder_contract}`
                : `Needs an NFT from ${p.holder_contract}`;
            }
          } else if (p.rule === "opensea" && p.opensea_slug) {
            status = "sign_in";
            eligibilityType = "whitelist";
            detail = "Sign in with OpenSea to verify whitelist eligibility";
          }
          return {
            key: `m:${p.id}`,
            name: p.name,
            x_handle: p.x_handle,
            image: p.image_url,
            chain: p.chain,
            source: "manual",
            source_url: p.mint_url ?? p.website ?? p.x_url,
            checked_at: new Date().toISOString(),
            status,
            eligibility_type: eligibilityType,
            detail,
            mint_url: p.mint_url ?? p.website,
            start_time: p.mint_date,
            price: p.price,
            opensea_slug: p.opensea_slug,
          } satisfies ResultItem;
        }),
    );

    let drops: ResultItem[] = [];
    let sourceWarning: string | null = null;
    try {
      const dropLookup = await loadDrops(supportedChains);
      drops = dropLookup.items;
      sourceWarning = dropLookup.warning;
    } catch (error) {
      console.error("OpenSea drop lookup failed", error);
      sourceWarning =
        error instanceof Error && error.message === "OpenSea key missing"
          ? "OpenSea listings are not configured yet. Admin-curated projects can still be checked."
          : "OpenSea listings are temporarily unavailable. Admin-curated projects were still checked.";
    }
    const uniqueManual = dedupeCollections(manual);
    const manualSlugs = new Set(
      uniqueManual
        .filter((item) => item.opensea_slug)
        .map((item) => collectionIdentityKey(item.chain, item.opensea_slug!)),
    );
    return {
      error: null,
      kind,
      items: dedupeCollections([
        ...uniqueManual,
        ...drops.filter(
          (drop) => !manualSlugs.has(collectionIdentityKey(drop.chain, drop.opensea_slug ?? "")),
        ),
      ]),
      sourceWarning,
    };
  });

export const openseaNonce = createServerFn({ method: "POST" }).handler(async () => {
  const res = await fetch(`${OS}/api/v2/auth/siwe/nonce`, { method: "POST" });
  if (!res.ok) throw new Error("OpenSea sign-in is unavailable right now");
  const nonce = stringField(asObject(await res.json()) ?? {}, "nonce");
  if (!nonce) throw new Error("OpenSea returned an invalid sign-in nonce");
  return { nonce };
});

const siweSchema = z.object({
  message: z.object({
    domain: z.literal("opensea.io"),
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    statement: z.string(),
    uri: z.literal("https://opensea.io"),
    version: z.literal("1"),
    chainId: z.literal("1"),
    nonce: z.string().min(4).max(100),
    issuedAt: z.string(),
    accountType: z.literal("Ethereum"),
  }),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  slugs: z.array(z.string().max(200)).max(80),
});

/**
 * Uses OpenSea's official sign-in. The signed-in pass only has the read-only
 * "check eligibility" permission, lives for one request, and is revoked after.
 */
export const openseaEligibility = createServerFn({ method: "POST" })
  .validator((d: unknown) => siweSchema.parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env["OPENSEA_API_KEY"];
    if (!apiKey) throw new Error("OpenSea key missing");
    const verify = await fetch(`${OS}/api/v2/auth/siwe/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: data.message, signature: data.signature, chainArch: "EVM" }),
    });
    if (!verify.ok) {
      console.error("siwe verify", verify.status, (await verify.text()).slice(0, 300));
      return { error: "OpenSea didn't accept the signature. Please try again.", results: {} };
    }
    const headersWithCookies = verify.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies = headersWithCookies.getSetCookie?.() ?? [
      verify.headers.get("set-cookie") ?? "",
    ];
    const cookie = setCookies
      .map((c) => c.split(";")[0])
      .filter(Boolean)
      .join("; ");

    const pat = await fetch(`${OS}/api/v2/auth/tokens`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        label: "Mint Radar eligibility check",
        scopes: ["read:eligibility"],
        expiresInDays: 1,
      }),
    });
    if (!pat.ok) {
      console.error("pat", pat.status, (await pat.text()).slice(0, 300));
      return { error: "OpenSea sign-in worked, but the check couldn't start.", results: {} };
    }
    const patJson = asObject(await pat.json()) ?? {};
    const patId = firstString(patJson, ["id", "tokenId"]);
    if (!patId) throw new Error("OpenSea did not provide an ID for the temporary eligibility pass");

    const revokeTemporaryToken = async () => {
      if (!patId) return;
      const revoke = await fetch(`${OS}/api/v2/auth/tokens/${encodeURIComponent(patId)}`, {
        method: "DELETE",
        headers: { cookie },
      });
      if (!revoke.ok) throw new Error("OpenSea couldn't revoke the temporary eligibility pass.");
    };

    let response: {
      error: string | null;
      results: Record<
        string,
        { whitelistStages: string[]; publicStages: string[]; unknownStages: string[] } | null
      >;
    };
    try {
      const subjectToken = firstString(patJson, ["token", "value", "accessToken", "pat", "secret"]);
      if (!subjectToken) throw new Error("OpenSea did not return a sign-in token");
      const ex = await fetch(`${OS}/api/v2/auth/tokens/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subjectToken, subjectTokenType: "ACCESS_TOKEN" }),
      });
      if (!ex.ok) {
        console.error("exchange", ex.status, (await ex.text()).slice(0, 300));
        response = { error: "OpenSea didn't issue a check pass.", results: {} };
      } else {
        const accessToken = stringField(asObject(await ex.json()) ?? {}, "accessToken");
        if (!accessToken) throw new Error("OpenSea did not return an eligibility token");

        const results: Record<
          string,
          { whitelistStages: string[]; publicStages: string[]; unknownStages: string[] } | null
        > = {};
        await Promise.all(
          data.slugs.map(async (slug) => {
            const result = await osGet(`/api/v2/drops/${encodeURIComponent(slug)}/eligibility`, {
              Authorization: `Bearer ${accessToken}`,
            });
            if (!result) return void (results[slug] = null);
            const stages = asObjects(result["stages"]).map((stage) => ({
              stage_type: stringField(stage, "stage_type"),
              label: firstString(stage, ["label", "stage_type"]) ?? "Stage",
              is_eligible: stage["is_eligible"] === true,
            }));
            const split = splitOpenSeaEligibleStages(stages);
            results[slug] = {
              whitelistStages: split.whitelistStages.map((stage) => stage.label),
              publicStages: split.publicStages.map((stage) => stage.label),
              unknownStages: split.unknownStages.map((stage) => stage.label),
            };
          }),
        );
        response = { error: null, results };
      }
    } catch (error) {
      await revokeTemporaryToken();
      throw error;
    }
    await revokeTemporaryToken();
    return response;
  });

export const fetchXProject = createServerFn({ method: "POST" })
  .middleware([requireAdminSession])
  .validator((d: unknown) => z.object({ link: z.string().min(1).max(300) }).parse(d))
  .handler(async ({ data }) => {
    const handle = parseXHandle(data.link);
    if (!handle) return { error: "That isn't a valid X link or handle." };
    let name = handle;
    let description: string | null = null;
    let image: string | null = `https://unavatar.io/x/${handle}`;
    let website: string | null = null;
    let warning: string | null = null;
    try {
      const r = await fetch(`https://api.fxtwitter.com/2/profile/${handle}`);
      if (!r.ok) {
        warning = "Profile details could not be fetched. Review and enter them manually.";
      } else {
        const profile = asObject(await r.json());
        const u = asObject(profile?.["user"]);
        if (u) {
          name = stringField(u, "name") ?? name;
          description = stringField(u, "description");
          image = stringField(u, "avatar_url")?.replace("_normal", "_400x400") ?? image;
          const site = asObject(u["website"]);
          website = site ? firstString(site, ["url", "display_url"]) : null;
        } else warning = "Profile details could not be read. Review and enter them manually.";
      }
    } catch (e) {
      console.error("x profile", e);
      warning = "Profile details could not be fetched. Review and enter them manually.";
    }
    return {
      error: null,
      warning,
      project: {
        name,
        x_handle: handle,
        x_url: `https://x.com/${handle}`,
        description,
        image_url: image,
        website,
      },
    };
  });
