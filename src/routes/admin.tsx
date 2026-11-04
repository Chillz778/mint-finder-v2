import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

import {
  adminLogin,
  adminLogout,
  adminSession,
  createAdminProject,
  getAdminProjects,
  uploadAdminAllowlist,
} from "@/lib/admin.functions";
import { fetchXProject } from "@/lib/checker.functions";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/admin")({
  component: Admin,
});

type Access = "loading" | "signed_out" | "admin";
type Rule = Database["public"]["Tables"]["projects"]["Row"]["rule"];
type ProjectDraft = {
  name: string;
  x_handle: string;
  x_url: string;
  description: string;
  image_url: string;
  website: string;
  mint_url: string;
  rule: Rule;
  holder_contract: string;
  opensea_slug: string;
  mint_date: string;
  price: string;
};
type ProjectOption = { id: string; name: string };

const emptyDraft: ProjectDraft = {
  name: "",
  x_handle: "",
  x_url: "",
  description: "",
  image_url: "",
  website: "",
  mint_url: "",
  rule: "check_site",
  holder_contract: "",
  opensea_slug: "",
  mint_date: "",
  price: "",
};

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function Admin() {
  const [access, setAccess] = useState<Access>("loading");
  const [pageError, setPageError] = useState("");
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [xLink, setXLink] = useState("");
  const [draft, setDraft] = useState<ProjectDraft>(emptyDraft);
  const [allowlistProject, setAllowlistProject] = useState("");
  const [wallets, setWallets] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { authenticated } = await adminSession();
        if (active) setAccess(authenticated ? "admin" : "signed_out");
      } catch (error) {
        if (active) {
          setPageError(messageFrom(error));
          setAccess("signed_out");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (access !== "admin") return;
    let active = true;
    void (async () => {
      try {
        const options = await getAdminProjects();
        if (!active) return;
        setProjects(options);
        setAllowlistProject((current) => current || options[0]?.id || "");
      } catch (error) {
        if (active) setPageError(messageFrom(error));
      }
    })();
    return () => {
      active = false;
    };
  }, [access]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setPageError("");
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    try {
      await adminLogin({ data: { password } });
      setAccess("admin");
      setPageError("");
    } catch (error) {
      setPageError(messageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setPageError("");
    try {
      await adminLogout();
      setAccess("signed_out");
    } catch (error) {
      setPageError(messageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  async function lookUpX(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setPageError("");
    setNotice("");
    try {
      const result = await fetchXProject({ data: { link: xLink } });
      if (result.error) {
        setPageError(result.error);
        return;
      }
      setDraft((current) => ({
        ...current,
        name: result.project.name,
        x_handle: result.project.x_handle,
        x_url: result.project.x_url,
        description: result.project.description ?? "",
        image_url: result.project.image_url ?? "",
        website: result.project.website ?? "",
      }));
      setNotice(result.warning ?? "Project details loaded. Review them before saving.");
    } catch (error) {
      setPageError(messageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setPageError("");
    setNotice("");
    try {
      const data = await createAdminProject({
        data: {
          name: draft.name.trim(),
          x_handle: draft.x_handle.trim() || null,
          x_url: draft.x_url.trim() || null,
          description: draft.description.trim() || null,
          image_url: draft.image_url.trim() || null,
          website: draft.website.trim() || null,
          mint_url: draft.mint_url.trim() || null,
          chain: "ethereum",
          rule: draft.rule,
          holder_contract: draft.holder_contract.trim() || null,
          opensea_slug: draft.opensea_slug.trim() || null,
          mint_date: draft.mint_date ? new Date(draft.mint_date).toISOString() : null,
          price: draft.price.trim() || null,
        },
      });
      setProjects((current) => [data, ...current]);
      setAllowlistProject(data.id);
      setDraft(emptyDraft);
      setXLink("");
      setNotice(`${data.name} was added.`);
    } catch (error) {
      setPageError(messageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  async function uploadAllowlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setPageError("");
    setNotice("");
    const addresses = [
      ...new Set(
        wallets
          .split(/[\s,;]+/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    const invalid = addresses.filter((address) => !/^0x[0-9a-fA-F]{40}$/.test(address));
    if (!allowlistProject) {
      setPageError("Add an Ethereum project before uploading an allowlist.");
      setBusy(false);
      return;
    }
    if (addresses.length === 0 || addresses.length > 10_000 || invalid.length > 0) {
      setPageError(
        addresses.length > 10_000
          ? "Upload up to 10,000 Ethereum addresses at a time."
          : invalid.length > 0
            ? `${invalid.length} address(es) are invalid. Use Ethereum 0x addresses only.`
            : "Paste at least one Ethereum address.",
      );
      setBusy(false);
      return;
    }

    try {
      const result = await uploadAdminAllowlist({
        data: { projectId: allowlistProject, addresses },
      });
      setWallets("");
      setNotice(`Allowlist processed: ${result.imported} unique address(es).`);
    } catch (error) {
      setPageError(messageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="finder-app admin-page">
      <header className="site-header">
        <Link className="brand" to="/" aria-label="Mint Finder home">
          <span className="brand-mark">M</span>
          <span>
            mint<span className="brand-light">finder</span>
          </span>
        </Link>
        <Link className="admin-home-link" to="/">
          Back to finder
        </Link>
      </header>

      <main className="admin-main">
        <div className="section-kicker">PRIVATE PROJECT TOOLS</div>
        <h1>Project dashboard</h1>
        <p className="admin-intro">
          Manage Ethereum projects and allowlists. Wallet addresses are only used to check
          eligibility.
        </p>

        {pageError && (
          <p className="admin-message admin-error" role="alert">
            {pageError}
          </p>
        )}
        {notice && (
          <p className="admin-message admin-success" role="status">
            {notice}
          </p>
        )}

        {access === "loading" ? (
          <div className="admin-panel">Checking admin access…</div>
        ) : access === "signed_out" ? (
          <form className="admin-panel admin-login" onSubmit={signIn}>
            <h2>Owner access</h2>
            <p>Enter your private admin password to manage projects.</p>
            <label>
              Admin password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={16}
                required
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? "Checking…" : "Unlock admin"}
            </button>
            <small>
              Use a long password you set in the server environment. It is not stored in this
              browser.
            </small>
          </form>
        ) : (
          <>
            <div className="admin-userbar">
              <span>Secure admin session active</span>
              <button type="button" onClick={signOut} disabled={busy}>
                Sign out
              </button>
            </div>

            <section className="admin-panel">
              <h2>Add an Ethereum project</h2>
              <p>Paste a public X profile link to prefill details, then review and save.</p>
              <form className="admin-inline-form" onSubmit={lookUpX}>
                <input
                  aria-label="X profile link"
                  value={xLink}
                  onChange={(event) => setXLink(event.target.value)}
                  placeholder="https://x.com/project"
                  required
                />
                <button type="submit" disabled={busy}>
                  {busy ? "Loading…" : "Fetch details"}
                </button>
              </form>
              <form className="admin-fields" onSubmit={saveProject}>
                <label>
                  Project name
                  <input
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    required
                  />
                </label>
                <label>
                  X handle
                  <input
                    value={draft.x_handle}
                    onChange={(event) => setDraft({ ...draft, x_handle: event.target.value })}
                    placeholder="@project"
                  />
                </label>
                <label>
                  Website
                  <input
                    type="url"
                    value={draft.website}
                    onChange={(event) => setDraft({ ...draft, website: event.target.value })}
                    placeholder="https://"
                  />
                </label>
                <label>
                  Mint site
                  <input
                    type="url"
                    value={draft.mint_url}
                    onChange={(event) => setDraft({ ...draft, mint_url: event.target.value })}
                    placeholder="https://"
                  />
                </label>
                <label className="admin-wide">
                  Description
                  <textarea
                    value={draft.description}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                    rows={2}
                  />
                </label>
                <label>
                  Eligibility rule
                  <select
                    value={draft.rule}
                    onChange={(event) => setDraft({ ...draft, rule: event.target.value })}
                  >
                    <option value="check_site">Check project site</option>
                    <option value="public">Public mint</option>
                    <option value="allowlist">My uploaded allowlist</option>
                    <option value="holder">Hold an NFT collection</option>
                    <option value="opensea">OpenSea gated drop</option>
                  </select>
                </label>
                {draft.rule === "holder" && (
                  <label>
                    OpenSea collection slug
                    <input
                      value={draft.holder_contract}
                      onChange={(event) =>
                        setDraft({ ...draft, holder_contract: event.target.value })
                      }
                      required
                    />
                  </label>
                )}
                {draft.rule === "opensea" && (
                  <label>
                    OpenSea drop slug
                    <input
                      value={draft.opensea_slug}
                      onChange={(event) => setDraft({ ...draft, opensea_slug: event.target.value })}
                      required
                    />
                  </label>
                )}
                <button className="admin-wide" type="submit" disabled={busy || !draft.name.trim()}>
                  Save project
                </button>
              </form>
            </section>

            <section className="admin-panel">
              <h2>Upload an allowlist</h2>
              <p>Paste Ethereum addresses separated by new lines, spaces, or commas.</p>
              <form className="admin-fields" onSubmit={uploadAllowlist}>
                <label className="admin-wide">
                  Project
                  <select
                    value={allowlistProject}
                    onChange={(event) => setAllowlistProject(event.target.value)}
                    required
                  >
                    <option value="">Select a project</option>
                    {projects.map((project) => (
                      <option value={project.id} key={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-wide">
                  Wallet addresses
                  <textarea
                    value={wallets}
                    onChange={(event) => setWallets(event.target.value)}
                    rows={6}
                    placeholder="0x...&#10;0x..."
                    required
                  />
                </label>
                <button className="admin-wide" type="submit" disabled={busy}>
                  {busy ? "Uploading…" : "Upload addresses"}
                </button>
              </form>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
