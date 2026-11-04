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
  active_stage: OpenSeaStage | null;
  next_stage: OpenSeaStage | null;
};

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

function weiToEth(wei: string | null | undefined) {
  if (wei == null) return null;
  try {
    const n = Number(BigInt(wei)) / 1e18;
    return n === 0 ? "Free" : `${n} ETH`;
  } catch {
    return null;
  }
}

async function loadDrops(chains: string[]): Promise<ResultItem[]> {
  const chainFilter = encodeURIComponent(chains.join(","));
  const lists = await Promise.all(
    ["featured", "upcoming", "recently_minted"].map((type) =>
      osGet(`/api/v2/drops?type=${type}&limit=100&chains=${chainFilter}`),
    ),
  );
  if (lists.every((list) => list == null)) {
    throw new Error("OpenSea drop listings are unavailable");
  }
  const seen = new Map<string, OpenSeaDrop>();
  for (const l of lists) {
    for (const rawDrop of asObjects(l?.["drops"])) {
      const drop = parseDrop(rawDrop);
      const key = drop ? collectionIdentityKey(drop.chain, drop.collection_slug) : "";
      if (drop && chains.includes(drop.chain) && !seen.has(key)) {
        seen.set(key, drop);
      }
    }
  }
  const drops = [...seen.values()]
    .filter((drop) => isMintingOrUpcoming(drop.is_minting, drop.next_stage?.start_time ?? null))
    .slice(0, 100);
  const handles: Array<{ x: string | null; site: string | null }> = [];
  for (let offset = 0; offset < drops.length; offset += 10) {
    const batch = await Promise.all(
      drops.slice(offset, offset + 10).map(async (drop) => {
        const collection = await osGet(
          `/api/v2/collections/${encodeURIComponent(drop.collection_slug)}`,
        );
        return {
          x: collection ? stringField(collection, "twitter_username") : null,
          site: collection ? stringField(collection, "project_url") : null,
        };
      }),
    );
    handles.push(...batch);
  }
  const checkedAt = new Date().toISOString();
  return dedupeCollections(
    drops.map((d, i) => {
      const stage = d.is_minting ? d.active_stage : d.next_stage;
      const handle = handles[i];
      const isPublic = stage?.stage_type === "public_sale";
      const status = isPublic ? "eligible" : stage ? "sign_in" : "check_site";
      return {
        key: `os:${d.collection_slug}`,
        name: d.collection_name,
        x_handle: handle?.x ?? null,
        image: d.image_url ?? null,
        chain: d.chain,
        source: "opensea",
        source_url: `https://opensea.io/collection/${encodeURIComponent(d.collection_slug)}`,
        checked_at: checkedAt,
        status,
        eligibility_type: isPublic ? "public" : stage ? "whitelist" : "site",
        detail:
          status === "eligible"
            ? `${stage?.label ?? "Public stage"} — OpenSea lists this as open to every wallet; it is not a wallet-specific eligibility check`
            : status === "sign_in"
              ? `${stage?.label ?? "Restricted stage"} — sign in with OpenSea to check eligibility`
              : d.is_minting
                ? "Minting is live — check the official page for details"
                : "No active or upcoming stage listed — check the project site",
        mint_url: d.opensea_url ?? handle?.site ?? null,
        start_time: stage?.start_time ?? null,
        price: weiToEth(stage?.price),
        opensea_slug: d.collection_slug,
      } satisfies ResultItem;
    }),
  );
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
      drops = await loadDrops(supportedChains);
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
