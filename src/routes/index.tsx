import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleHelp,
  Layers3,
  Search,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { adminLogin } from "@/lib/admin.functions";
import { checkWallet, openseaEligibility, openseaNonce } from "@/lib/checker.functions";
import {
  buildSiweMessage,
  CHAIN_OPTIONS,
  chainLabel,
  detectWalletKind,
  siweText,
  withOpenSeaEligibility,
  type ResultItem,
} from "@/lib/chains";

export const Route = createFileRoute("/")({
  component: Index,
});

const filters = ["All results", "Public mint", "Whitelist mint"] as const;
type Filter = (typeof filters)[number];

function statusLabel(item: ResultItem) {
  switch (item.status) {
    case "eligible":
      if (item.eligibility_type === "public") {
        if (item.eligibility_verified) return "Eligible for public phase";
        return item.source === "opensea" ? "Public stage listed" : "Owner-listed public mint";
      }
      return "Eligible";
    case "not_eligible":
      return "Not eligible";
    case "sign_in":
      return "OpenSea sign-in required";
    case "check_site":
      return "Check project site";
    case "unknown":
      return "Could not verify";
  }
}

function sourceLabel(item: ResultItem) {
  if (item.source === "opensea") {
    return item.eligibility_verified ? "OpenSea eligibility check" : "OpenSea drop listing";
  }
  if (item.eligibility_type === "whitelist") {
    return item.status === "sign_in" ? "Owner-managed OpenSea gate" : "Owner-managed allowlist";
  }
  if (item.eligibility_type === "holder") return "Owner-set holder rule · OpenSea holdings";
  return "Owner-managed project entry";
}

function formatCheckedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "time unavailable";
  return `${new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(date)} WAT`;
}

function ResultProvenance({ item }: { item: ResultItem }) {
  return (
    <div className="result-provenance" aria-label="Result source and check time">
      <span>{sourceLabel(item)}</span>
      {item.source_url ? (
        <a href={item.source_url} target="_blank" rel="noreferrer">
          View source <ArrowUpRight size={12} />
        </a>
      ) : (
        <span>Source link unavailable</span>
      )}
      <span>Checked {formatCheckedAt(item.checked_at)}</span>
    </div>
  );
}

function chainDotClass(chain: string) {
  if (chain === "solana") return "sol-dot";
  if (chain === "robinhood") return "rh-dot";
  if (chain === "base") return "base-dot";
  return "eth-dot";
}

function whitelistStatusLabel(item: ResultItem) {
  if (item.status === "eligible") {
    return item.eligibility_type === "holder" ? "Holder requirement met" : "Whitelisted";
  }
  if (item.status === "not_eligible") {
    return item.eligibility_type === "holder" ? "Holder requirement not met" : "Not on whitelist";
  }
  if (item.status === "sign_in") return "OpenSea sign-in required";
  if (item.status === "unknown") return "Could not verify";
  return "Manual check needed";
}

function Index() {
  const navigate = useNavigate();
  const [wallet, setWallet] = useState("");
  const [connectedWallet, setConnectedWallet] = useState("");
  const [walletMessage, setWalletMessage] = useState("");
  const [walletError, setWalletError] = useState("");
  const [walletDisclaimerOpen, setWalletDisclaimerOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [results, setResults] = useState<ResultItem[] | null>(null);
  const [sourceWarning, setSourceWarning] = useState("");
  const [filter, setFilter] = useState<Filter>("All results");
  const [query, setQuery] = useState("");
  const [adminDialog, setAdminDialog] = useState<"question" | "password" | null>(null);
  const [adminError, setAdminError] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [eligibilityBusy, setEligibilityBusy] = useState("");
  const [eligibilityMessages, setEligibilityMessages] = useState<Record<string, string>>({});

  const whitelistItems = useMemo(() => {
    const searchTerm = query.trim().toLowerCase();
    return (results ?? []).filter(
      (item) =>
        item.eligibility_type !== "public" &&
        (!searchTerm ||
          item.name.toLowerCase().includes(searchTerm) ||
          (item.x_handle ?? "").toLowerCase().includes(searchTerm)),
    );
  }, [query, results]);

  const visibleDrops = useMemo(() => {
    const searchTerm = query.trim().toLowerCase();
    return (results ?? []).filter((drop) => {
      if (drop.eligibility_type !== "public" || filter === "Whitelist mint") return false;
      const matchesFilter = filter === "All results" || filter === "Public mint";
      const matchesSearch =
        !searchTerm ||
        drop.name.toLowerCase().includes(searchTerm) ||
        (drop.x_handle ?? "").toLowerCase().includes(searchTerm);
      return matchesFilter && matchesSearch;
    });
  }, [filter, query, results]);

  async function checkOpenSeaEligibility(items: ResultItem[], account: string) {
    const gatedItems = items.filter((item) => item.status === "sign_in" && item.opensea_slug);
    const slugs = [...new Set(gatedItems.map((item) => item.opensea_slug!))].slice(0, 80);
    if (slugs.length === 0) {
      setWalletMessage("Connected. No OpenSea gated phases need a signature right now.");
      return;
    }
    const provider = (
      window as Window & {
        ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
      }
    ).ethereum;
    if (!provider) throw new Error("Open an Ethereum wallet to check OpenSea gated phases.");

    setEligibilityBusy("batch");
    setEligibilityMessages({});
    try {
      const { nonce } = await openseaNonce();
      const message = buildSiweMessage(account, nonce, new Date().toISOString());
      const signature = await provider.request({
        method: "personal_sign",
        params: [siweText(message), account],
      });
      if (typeof signature !== "string") {
        throw new Error("The wallet did not return a signature.");
      }
      const response = await openseaEligibility({
        data: { message, signature, slugs },
      });
      if (response.error) {
        throw new Error(response.error);
      }
      const updated = items.map((item) => {
        if (!item.opensea_slug || !slugs.includes(item.opensea_slug)) return item;
        const result = response.results[item.opensea_slug];
        return result ? withOpenSeaEligibility(item, result) : item;
      });
      const missingCount = slugs.filter((slug) => !response.results[slug]).length;
      setResults(updated);
      setWalletMessage(
        missingCount === 0
          ? `OpenSea verified ${slugs.length} gated phase${slugs.length === 1 ? "" : "s"}.`
          : `OpenSea verified ${slugs.length - missingCount} of ${slugs.length} gated phases; ${missingCount} still need a manual check.`,
      );
      if (missingCount > 0) {
        const missingKeys = gatedItems
          .filter((item) => !response.results[item.opensea_slug!])
          .map((item) => item.key);
        setEligibilityMessages(
          Object.fromEntries(
            missingKeys.map((key) => [
              key,
              "OpenSea couldn't verify this phase. Check the project site.",
            ]),
          ),
        );
      }
    } catch (error) {
      const walletError = error as { code?: number };
      const messageText =
        walletError.code === 4001
          ? "OpenSea message signature cancelled. Gated statuses remain unverified; no transaction was sent."
          : error instanceof Error
            ? `${error.message} Gated statuses remain unverified.`
            : "OpenSea eligibility check failed. Gated statuses remain unverified.";
      setEligibilityMessages(Object.fromEntries(gatedItems.map((item) => [item.key, messageText])));
      setWalletMessage(messageText);
    } finally {
      setEligibilityBusy("");
    }
  }

  async function connectWalletAndCheck() {
    setWalletDisclaimerOpen(false);
    setWalletError("");
    setWalletMessage("");
    const provider = (
      window as Window & {
        ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
      }
    ).ethereum;
    if (!provider) {
      setWalletError(
        "No Ethereum wallet was found. Open this page in a browser with your wallet extension.",
      );
      return;
    }

    setEligibilityBusy("connect");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const account = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "";
      if (!account || detectWalletKind(account) !== "evm") {
        throw new Error("The wallet did not return a supported Ethereum address.");
      }
      setConnectedWallet(account);
      setWallet(account);
      setIsChecking(true);
      const response = await checkWallet({ data: { address: account } });
      if (response.error) throw new Error(response.error);
      setResults(response.items);
      setSourceWarning(response.sourceWarning ?? "");
      setFilter("All results");
      setWalletMessage(
        `Connected ${account.slice(0, 6)}…${account.slice(-4)}. Checking configured project rules.`,
      );
      await checkOpenSeaEligibility(response.items, account);
    } catch (error) {
      const walletError = error as { code?: number };
      setWalletMessage(
        walletError.code === 4001 ? "Wallet connection cancelled. No transaction was sent." : "",
      );
      if (walletError.code !== 4001) {
        setWalletError(error instanceof Error ? error.message : "Wallet connection failed.");
      }
    } finally {
      setIsChecking(false);
      setEligibilityBusy("");
    }
  }

  async function disconnectWallet() {
    const provider = (
      window as Window & {
        ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
      }
    ).ethereum;
    let permissionRevoked = false;
    if (provider && connectedWallet) {
      try {
        await provider.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }],
        });
        permissionRevoked = true;
      } catch {
        // The wallet may not expose a programmatic disconnect method.
      }
    }
    setConnectedWallet("");
    setWallet("");
    setResults(null);
    setEligibilityMessages({});
    setWalletMessage(
      permissionRevoked
        ? "Wallet disconnected and its address was cleared from this page."
        : "Wallet details and results were cleared from this page. If the wallet still lists this site as connected, disconnect it in the wallet's connected-sites settings.",
    );
  }

  async function handleWalletSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const kind = detectWalletKind(wallet);

    if (!kind) {
      setWalletError("Enter a valid EVM (0x...) or Solana address.");
      setWalletMessage("");
      return;
    }

    setIsChecking(true);
    setWalletError("");
    setWalletMessage("");
    setResults(null);
    setSourceWarning("");
    setEligibilityMessages({});
    setFilter("All results");

    try {
      const response = await checkWallet({ data: { address: wallet.trim() } });
      if (response.error) {
        setWalletError(response.error);
        return;
      }
      setResults(response.items);
      setSourceWarning(response.sourceWarning ?? "");
      if (connectedWallet && connectedWallet.toLowerCase() === wallet.trim().toLowerCase()) {
        await checkOpenSeaEligibility(response.items, connectedWallet);
      } else {
        setWalletMessage(
          `Checked ${wallet.trim().slice(0, 6)}…${wallet.trim().slice(-4)}. Your address was not stored.`,
        );
      }
    } catch (error) {
      console.error("Wallet eligibility check failed", error);
      setWalletError(
        "We couldn't complete the check. Please try again later or contact the site owner.",
      );
    } finally {
      setIsChecking(false);
    }
  }

  async function handleAdminLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdminBusy(true);
    setAdminError("");
    const formData = new FormData(event.currentTarget);
    try {
      await adminLogin({ data: { password: String(formData.get("admin-password") ?? "") } });
      setAdminDialog(null);
      void navigate({ to: "/admin" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Admin sign-in failed. Please try again.";
      setAdminError(message);
      if (message.startsWith("Incorrect admin password")) {
        window.setTimeout(() => {
          setAdminDialog(null);
          setAdminError("");
        }, 1800);
      }
    } finally {
      setAdminBusy(false);
    }
  }

  return (
    <div className="finder-app">
      <header className="site-header">
        <button
          className="public-user-button"
          type="button"
          onClick={() => {
            setAdminError("");
            setAdminDialog("question");
          }}
        >
          Public user active
        </button>
        <a className="brand" href="#top" aria-label="Mint Finder home">
          <img className="brand-logo" src="/mintfinder-logo.svg" alt="" />
          <span>
            mint<span className="brand-light">finder</span>
          </span>
        </a>

        <nav className="main-nav" aria-label="Main navigation">
          <a className="nav-active" href="#drops">
            Explore drops
          </a>
          <a href="#how-it-works">How it works</a>
        </nav>

        <div className="header-note">
          <span className="live-dot" />4 supported networks
        </div>
      </header>

      {adminDialog && (
        <div
          className="admin-gate-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !adminBusy) setAdminDialog(null);
          }}
        >
          <section
            aria-labelledby="admin-gate-title"
            aria-modal="true"
            className="admin-gate-dialog"
            role="dialog"
          >
            <button
              aria-label="Close"
              className="admin-gate-close"
              disabled={adminBusy}
              onClick={() => setAdminDialog(null)}
              type="button"
            >
              ×
            </button>
            {adminDialog === "question" ? (
              <>
                <div className="section-kicker">ACCOUNT ACCESS</div>
                <h2 id="admin-gate-title">Are you an admin?</h2>
                <p>Public browsing stays available to everyone.</p>
                <div className="admin-gate-actions">
                  <button type="button" onClick={() => setAdminDialog(null)}>
                    No, continue as public
                  </button>
                  <button type="button" onClick={() => setAdminDialog("password")}>
                    Yes
                  </button>
                </div>
              </>
            ) : (
              <form className="admin-gate-form" onSubmit={handleAdminLogin}>
                <div className="section-kicker">OWNER ACCESS</div>
                <h2 id="admin-gate-title">Enter your admin password</h2>
                <p>This password is checked securely by the server.</p>
                <label className="sr-only" htmlFor="admin-gate-password">
                  Admin password
                </label>
                <input
                  autoComplete="current-password"
                  autoFocus
                  id="admin-gate-password"
                  minLength={16}
                  name="admin-password"
                  required
                  type="password"
                />
                {adminError && (
                  <p className="admin-gate-error" role="alert">
                    {adminError}
                  </p>
                )}
                <div className="admin-gate-actions">
                  <button
                    disabled={adminBusy}
                    onClick={() => setAdminDialog("question")}
                    type="button"
                  >
                    Back
                  </button>
                  <button disabled={adminBusy} type="submit">
                    {adminBusy ? "Checking…" : "Continue"}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}

      {walletDisclaimerOpen && (
        <div
          className="wallet-disclaimer-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && eligibilityBusy === "") {
              setWalletDisclaimerOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="wallet-disclaimer-title"
            aria-modal="true"
            className="wallet-disclaimer-dialog"
            role="dialog"
          >
            <button
              aria-label="Close wallet information"
              className="admin-gate-close"
              disabled={eligibilityBusy !== ""}
              onClick={() => setWalletDisclaimerOpen(false)}
              type="button"
            >
              ×
            </button>
            <div className="section-kicker">READ THIS BEFORE CONTINUING</div>
            <h2 id="wallet-disclaimer-title">What connecting your wallet does</h2>
            <div className="wallet-disclaimer-alert">
              <strong>A wallet warning is not a guarantee of safety.</strong> Your wallet may flag
              this site or the sign-in request. Do not dismiss warnings automatically. Continue only
              if the wallet shows the OpenSea sign-in message described below; cancel anything that
              asks for a transaction, token approval, or anything unexpected.
            </div>
            <ul className="wallet-disclaimer-points">
              <li>
                <strong>Connect:</strong> shares your public address with Mint Finder so it can
                check configured project rules. It does not give the site your private key or move
                funds.
              </li>
              <li>
                <strong>Gated phase check:</strong> OpenSea requires a separate message signature.
                The prompt should say <strong>opensea.io</strong> and sign you in to OpenSea. It
                includes OpenSea’s Terms and Privacy Policy. This signature is not a blockchain
                transaction and has no gas fee.
              </li>
              <li>
                <strong>Eligibility results:</strong> after that signature, Mint Finder requests
                OpenSea’s read-only eligibility data for the listed gated drops. The temporary
                eligibility token is revoked after the check. If you cancel or OpenSea cannot verify
                a phase, that status remains unverified.
              </li>
              <li>
                <strong>Never share</strong> your recovery phrase or private key. Mint Finder will
                never ask for either.
              </li>
            </ul>
            <p className="wallet-disclaimer-final">
              Connecting is optional. Read the actual wallet prompt carefully and continue only if
              it matches what is explained here.
            </p>
            <div className="wallet-disclaimer-actions">
              <button type="button" onClick={() => setWalletDisclaimerOpen(false)}>
                Cancel
              </button>
              <button
                disabled={eligibilityBusy !== ""}
                onClick={() => void connectWalletAndCheck()}
                type="button"
              >
                {eligibilityBusy ? "Waiting for wallet…" : "Connect & check gated phases"}
              </button>
            </div>
          </section>
        </div>
      )}

      <main id="top">
        <section className="hero-section">
          <div className="hero-copy">
            <div className="eyebrow">
              <span /> THE MINT RADAR
            </div>
            <h1>
              Your next mint
              <br />
              might be <span>closer</span> than you think.
            </h1>
            <p className="hero-description">
              Check public wallet eligibility across Ethereum, Base, Robinhood Chain, and Solana. No
              connection is needed unless you choose to verify a gated OpenSea drop.
            </p>
            <div className="hero-proof">
              <span>
                <ShieldCheck size={16} /> Read-only by design
              </span>
              <span className="proof-divider" />
              <span>No seed phrase. Ever.</span>
            </div>
          </div>

          <div className="scan-card">
            <div className="scan-card-heading">
              <div className="scan-icon">
                <Wallet size={19} />
              </div>
              <div>
                <h2>Check a wallet</h2>
                <p>Paste a public address to get started</p>
              </div>
              <button className="help-button" type="button" aria-label="About wallet checks">
                <CircleHelp size={18} />
              </button>
            </div>
            <form className="wallet-form" onSubmit={handleWalletSubmit} noValidate>
              <label className="sr-only" htmlFor="wallet-address">
                Wallet address
              </label>
              <input
                id="wallet-address"
                autoComplete="off"
                spellCheck={false}
                disabled={eligibilityBusy !== "" || isChecking}
                value={wallet}
                onChange={(event) => {
                  const nextWallet = event.target.value;
                  setWallet(nextWallet);
                  if (
                    connectedWallet &&
                    connectedWallet.toLowerCase() !== nextWallet.toLowerCase()
                  ) {
                    setConnectedWallet("");
                    setResults(null);
                  }
                  setWalletMessage("");
                  setWalletError("");
                }}
                placeholder="0x... EVM or Solana address"
              />
              <button type="submit" disabled={isChecking}>
                {isChecking ? "Checking..." : "Check address"}{" "}
                {!isChecking && <ArrowRight size={16} />}
              </button>
            </form>
            <div className="wallet-connect-row">
              {connectedWallet ? (
                <>
                  <span className="wallet-connected-address" role="status">
                    Connected {connectedWallet.slice(0, 6)}…{connectedWallet.slice(-4)}
                  </span>
                  <button
                    className="wallet-connect-button wallet-disconnect-button"
                    disabled={eligibilityBusy !== ""}
                    onClick={() => void disconnectWallet()}
                    type="button"
                  >
                    Disconnect wallet
                  </button>
                </>
              ) : (
                <button
                  className="wallet-connect-button"
                  onClick={() => setWalletDisclaimerOpen(true)}
                  type="button"
                >
                  Connect wallet
                </button>
              )}
            </div>
            <div className="supported-chains">
              <span>NETWORKS</span>
              {CHAIN_OPTIONS.map((chain) => (
                <span className="chain-label" key={chain.value}>
                  <i className={`chain-dot ${chainDotClass(chain.value)}`} /> {chain.label}
                </span>
              ))}
            </div>
            {walletMessage && (
              <p className="wallet-feedback" role="status">
                {walletMessage}
              </p>
            )}
            {walletError && (
              <p className="wallet-feedback feedback-error" role="alert">
                {walletError}
              </p>
            )}
          </div>
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
        </section>

        <section className="trust-strip" aria-label="Product benefits">
          <div>
            <ShieldCheck size={17} />
            <span>Your wallet stays yours</span>
          </div>
          <span className="trust-separator" />
          <div>
            <Layers3 size={17} />
            <span>Four networks, one simple check</span>
          </div>
          <span className="trust-separator" />
          <div>
            <Sparkles size={17} />
            <span>Find drops worth watching</span>
          </div>
          <span className="preview-disclaimer">Your wallet address is checked, never stored</span>
        </section>

        <section className="drops-section" id="drops">
          <div className="section-heading">
            <div>
              <div className="section-kicker">YOUR RESULTS</div>
              <h2>
                Your mint radar<span>.</span>
              </h2>
              <p>Search projects by name or X handle after checking a wallet.</p>
            </div>
            <label className="search-field">
              <Search size={17} />
              <span className="sr-only">Search projects</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search results or @handle"
              />
              <kbd>/</kbd>
            </label>
          </div>

          <div className="drop-toolbar">
            <div className="filter-list" role="group" aria-label="Filter results">
              {filters.map((item) => (
                <button
                  className={`filter-button ${filter === item ? "filter-selected" : ""}`}
                  key={item}
                  onClick={() => setFilter(item)}
                  type="button"
                  aria-pressed={filter === item}
                >
                  {item === "Public mint" && <Check size={14} />}
                  {item}
                </button>
              ))}
            </div>
          </div>

          {!isChecking && filter !== "Public mint" && whitelistItems.length > 0 && (
            <section className="whitelist-section" aria-labelledby="whitelist-heading">
              <div className="whitelist-heading">
                <div>
                  <div className="section-kicker">WHITELIST AND GATED MINTS</div>
                  <h3 id="whitelist-heading">Whitelist and gated mints</h3>
                  <p>
                    Confirmed eligibility, gated checks, and projects that need a manual site check.
                    Public mint listings are shown separately.
                  </p>
                </div>
              </div>
              {whitelistItems.some((item) => item.status === "sign_in" && item.opensea_slug) && (
                <div className="eligibility-batch" role="status">
                  <div>
                    <strong>
                      {connectedWallet
                        ? "Wallet connected"
                        : "OpenSea gated phases need verification"}
                    </strong>
                    <p>
                      {connectedWallet
                        ? "A signed OpenSea message checks the gated phases in one read-only request."
                        : "Connect your wallet to check gated phases. A separate OpenSea message signature is required."}
                    </p>
                  </div>
                  {connectedWallet ? (
                    <button
                      disabled={eligibilityBusy !== ""}
                      onClick={() => void checkOpenSeaEligibility(results ?? [], connectedWallet)}
                      type="button"
                    >
                      {eligibilityBusy === "batch" ? "Checking phases…" : "Check gated phases"}
                    </button>
                  ) : (
                    <button onClick={() => setWalletDisclaimerOpen(true)} type="button">
                      Connect wallet
                    </button>
                  )}
                </div>
              )}
              <div className="whitelist-grid">
                {whitelistItems.map((item) => (
                  <article className="whitelist-card" key={item.key}>
                    <div className="whitelist-card-title">
                      <div>
                        <h4>{item.name}</h4>
                        {item.x_handle && (
                          <a
                            className="x-handle"
                            href={`https://x.com/${item.x_handle.replace(/^@/, "")}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            @{item.x_handle.replace(/^@/, "")}
                          </a>
                        )}
                      </div>
                      <span
                        className={`whitelist-status ${item.status === "eligible" ? "whitelist-status-yes" : item.status === "not_eligible" ? "whitelist-status-no" : ""}`}
                      >
                        {whitelistStatusLabel(item)}
                      </span>
                    </div>
                    <p>{item.detail}</p>
                    <ResultProvenance item={item} />
                    <div className="whitelist-card-footer">
                      <span className="chain-pill">
                        <i className={`chain-dot ${chainDotClass(item.chain)}`} />
                        {chainLabel(item.chain)}
                      </span>
                      {item.mint_url && (
                        <a href={item.mint_url} target="_blank" rel="noreferrer">
                          Official mint/checker <ArrowUpRight size={13} />
                        </a>
                      )}
                    </div>
                    {item.status === "sign_in" && (
                      <div className="eligibility-action">
                        <span>
                          {connectedWallet
                            ? "OpenSea could not confirm this phase yet. Use Check gated phases to retry."
                            : "Connect your wallet to check this OpenSea-gated phase."}
                        </span>
                        {eligibilityMessages[item.key] && (
                          <p className="eligibility-message" role="status">
                            {eligibilityMessages[item.key]}
                          </p>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          {isChecking ? (
            <div className="empty-state" role="status">
              <span className="loading-ring" />
              <h3>Checking your wallet</h3>
              <p>Looking for featured, upcoming, recently minted, and configured projects.</p>
            </div>
          ) : visibleDrops.length > 0 ? (
            <section className="result-group" aria-labelledby="public-mint-heading">
              <div className="result-group-heading">
                <div className="section-kicker">PUBLIC MINTS</div>
                <h3 id="public-mint-heading">Public mint</h3>
                <p>
                  These public stages are listed as open to all wallets; they are not
                  wallet-specific checks.
                </p>
              </div>
              <div className="drop-grid">
                {visibleDrops.map((drop, index) => (
                  <article className="drop-card" key={drop.key}>
                    <div className={`drop-art ${drop.image ? "drop-art-image" : "bloom"}`}>
                      {drop.image && (
                        <img src={drop.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
                      )}
                      {!drop.image && (
                        <span className="art-emblem">{drop.name.slice(0, 2).toUpperCase()}</span>
                      )}
                      <span
                        className={`status-tag ${drop.status === "eligible" ? "status-eligible" : drop.status === "not_eligible" ? "status-not-eligible" : "status-check"}`}
                      >
                        {drop.status === "eligible" && <Check size={12} />}
                        {statusLabel(drop)}
                      </span>
                      <span className="art-index">0{index + 1}</span>
                    </div>
                    <div className="drop-card-content">
                      <div className="drop-title-row">
                        <div>
                          <h3>{drop.name}</h3>
                          {drop.x_handle && (
                            <a
                              className="x-handle"
                              href={`https://x.com/${drop.x_handle.replace(/^@/, "")}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              @{drop.x_handle.replace(/^@/, "")}
                            </a>
                          )}
                        </div>
                        {drop.mint_url ? (
                          <a
                            href={drop.mint_url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open ${drop.name} mint or project site`}
                          >
                            <ArrowUpRight className="card-arrow" size={18} />
                          </a>
                        ) : (
                          <ArrowUpRight className="card-arrow" size={18} />
                        )}
                      </div>
                      <p className="drop-description">{drop.detail}</p>
                      <ResultProvenance item={drop} />
                      <div className="drop-card-footer">
                        <span className="chain-pill">
                          <i className={`chain-dot ${chainDotClass(drop.chain)}`} />
                          {chainLabel(drop.chain)}
                        </span>
                        <span className="drop-date">
                          {[drop.start_time, drop.price].filter(Boolean).join(" · ") ||
                            "Details pending"}
                        </span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : filter === "All results" && whitelistItems.length > 0 ? (
            <div className="empty-state">
              <Search size={22} />
              <h3>Whitelist and gated results are shown above</h3>
              <p>No public mint listings match this wallet check.</p>
            </div>
          ) : results ? (
            <div className="empty-state">
              <Search size={22} />
              <h3>{query ? "No matching results" : "No matching mint opportunities"}</h3>
              <p>
                {query
                  ? "Try another project name or X handle."
                  : "No configured opportunities were found for this wallet. This doesn't cover every mint site."}
              </p>
              {query && (
                <button type="button" onClick={() => setQuery("")}>
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <Search size={22} />
              <h3>Ready when you are</h3>
              <p>
                Enter a supported EVM or Solana wallet address above to check available sources and
                configured projects.
              </p>
            </div>
          )}
          {sourceWarning ? (
            <div className="sample-note feedback-error" role="status">
              <span className="sample-note-icon">
                <CircleHelp size={15} />
              </span>
              <p>{sourceWarning}</p>
            </div>
          ) : results ? (
            <div className="sample-note">
              <span className="sample-note-icon">
                <CircleHelp size={15} />
              </span>
              <p>
                <strong>Coverage note.</strong> Each result names its source and check time. Public
                stage listings do not confirm wallet-specific eligibility or guarantee a mint is
                still open. Owner-managed entries and allowlists depend on the site owner’s data;
                verify final details on the project’s official site.
              </p>
            </div>
          ) : null}
        </section>

        <section className="how-section" id="how-it-works">
          <div className="how-heading">
            <div className="section-kicker">SIMPLE BY DESIGN</div>
            <h2>From address to opportunity.</h2>
          </div>
          <div className="how-steps">
            <div className="how-step">
              <span className="step-number">01</span>
              <div className="step-icon">
                <Wallet size={19} />
              </div>
              <h3>Paste an address</h3>
              <p>Use a public wallet address. Connection is optional for OpenSea gated checks.</p>
            </div>
            <div className="step-connector" />
            <div className="how-step">
              <span className="step-number">02</span>
              <div className="step-icon">
                <Search size={19} />
              </div>
              <h3>Check across chains</h3>
              <p>Compare available public and project-configured results.</p>
            </div>
            <div className="step-connector" />
            <div className="how-step">
              <span className="step-number">03</span>
              <div className="step-icon">
                <Sparkles size={19} />
              </div>
              <h3>Choose what’s next</h3>
              <p>Review project details and head to the official source when ready.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <a className="brand footer-brand" href="#top">
          <img className="brand-logo" src="/mintfinder-logo.svg" alt="" />
          <span>
            mint<span className="brand-light">finder</span>
          </span>
        </a>
        <span>Stay curious. Mint carefully.</span>
        <span className="footer-note">Always verify a mint on the project’s official site.</span>
      </footer>
    </div>
  );
}
