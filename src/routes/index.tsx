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
import { checkWallet } from "@/lib/checker.functions";
import { chainLabel, detectWalletKind, type ResultItem } from "@/lib/chains";

export const Route = createFileRoute("/")({
  component: Index,
});

const filters = ["All results", "Eligible", "Not eligible", "Needs a manual check"] as const;
type Filter = (typeof filters)[number];

function statusLabel(status: ResultItem["status"]) {
  switch (status) {
    case "eligible":
      return "Eligible";
    case "not_eligible":
      return "Not eligible";
    case "sign_in":
      return "Sign in required";
    case "check_site":
      return "Check project site";
    case "unknown":
      return "Could not verify";
  }
}

function Index() {
  const navigate = useNavigate();
  const [wallet, setWallet] = useState("");
  const [walletMessage, setWalletMessage] = useState("");
  const [walletError, setWalletError] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [results, setResults] = useState<ResultItem[] | null>(null);
  const [sourceWarning, setSourceWarning] = useState("");
  const [filter, setFilter] = useState<Filter>("All results");
  const [query, setQuery] = useState("");
  const [adminDialog, setAdminDialog] = useState<"question" | "password" | null>(null);
  const [adminError, setAdminError] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);

  const visibleDrops = useMemo(() => {
    const searchTerm = query.trim().toLowerCase();
    return (results ?? []).filter((drop) => {
      const matchesFilter =
        filter === "All results" ||
        (filter === "Eligible" && drop.status === "eligible") ||
        (filter === "Not eligible" && drop.status === "not_eligible") ||
        (filter === "Needs a manual check" &&
          ["sign_in", "check_site", "unknown"].includes(drop.status));
      const matchesSearch =
        !searchTerm ||
        drop.name.toLowerCase().includes(searchTerm) ||
        (drop.x_handle ?? "").toLowerCase().includes(searchTerm);
      return matchesFilter && matchesSearch;
    });
  }, [filter, query, results]);

  async function handleWalletSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const kind = detectWalletKind(wallet);

    if (kind !== "evm") {
      setWalletError("Enter a valid Ethereum (0x...) address for this first version.");
      setWalletMessage("");
      return;
    }

    setIsChecking(true);
    setWalletError("");
    setWalletMessage("");
    setResults(null);
    setSourceWarning("");
    setFilter("All results");

    try {
      const response = await checkWallet({ data: { address: wallet.trim() } });
      if (response.error) {
        setWalletError(response.error);
        return;
      }
      setResults(response.items);
      setSourceWarning(response.sourceWarning ?? "");
      setWalletMessage(
        `Checked ${wallet.trim().slice(0, 6)}…${wallet.trim().slice(-4)}. Your address was not stored.`,
      );
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
          <span className="brand-mark">
            <Sparkles size={17} strokeWidth={2.2} />
          </span>
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
          <span className="live-dot" />
          Ethereum MVP
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
              Check Ethereum mint opportunities for a public wallet address. No wallet connection,
              signature, or seed phrase required.
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
                value={wallet}
                onChange={(event) => {
                  setWallet(event.target.value);
                  setWalletMessage("");
                  setWalletError("");
                }}
                placeholder="0x... Ethereum address"
              />
              <button type="submit" disabled={isChecking}>
                {isChecking ? "Checking..." : "Check address"}{" "}
                {!isChecking && <ArrowRight size={16} />}
              </button>
            </form>
            <div className="supported-chains">
              <span>SUPPORTED</span>
              <span className="chain-label">
                <i className="chain-dot eth-dot" /> Ethereum
              </span>
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
            <span>Ethereum, one simple check</span>
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
                  {item === "Eligible" && <Check size={14} />}
                  {item}
                </button>
              ))}
            </div>
          </div>

          {isChecking ? (
            <div className="empty-state" role="status">
              <span className="loading-ring" />
              <h3>Checking your wallet</h3>
              <p>Looking for public drops and configured project lists.</p>
            </div>
          ) : visibleDrops.length > 0 ? (
            <div className="drop-grid">
              {visibleDrops.map((drop, index) => (
                <article className="drop-card" key={drop.key}>
                  <div className={`drop-art ${drop.image ? "drop-art-image" : "bloom"}`}>
                    {drop.image && (
                      <img src={drop.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    )}
                    <span className="art-grain" />
                    {!drop.image && (
                      <span className="art-emblem">{drop.name.slice(0, 2).toUpperCase()}</span>
                    )}
                    <span
                      className={`status-tag ${drop.status === "eligible" ? "status-eligible" : drop.status === "not_eligible" ? "status-not-eligible" : "status-check"}`}
                    >
                      {drop.status === "eligible" && <Check size={12} />}
                      {statusLabel(drop.status)}
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
                    <div className="drop-card-footer">
                      <span className="chain-pill">
                        <i className="chain-dot eth-dot" />
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
                Enter an Ethereum wallet address above to check live sources and your project list.
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
                <strong>Coverage note.</strong> Results include only the sources configured here.
                Always verify allowlist and mint details on the project’s official site.
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
              <p>Use a public wallet address. No connection or signature needed to get started.</p>
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
          <span className="brand-mark">
            <Sparkles size={15} />
          </span>
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
