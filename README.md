# Mint Eligibility Finder

lets create a web app that's a nft eligibility checker , a user pastes in a wallet or( has to sign in or connect a wallet(make sure its safe) ) and sees all the nft project he is eligible to mint , across these chains , eth , robinhood , through opensea / magiceden or other free sources . if the project has its own mint site tell me id add the mint site manually and we can also make some improvements to push later on but the web app should be able to access the site and check the wallets if it can do that automatically no problem btw also let there be an option for me to manually add a project by pasting the x link , the web app should be able to fetch the other details ( this shouldn't be accessible to the general public only me ) and make sure it also displays the projects x handle when eligibility is known let the user be able to search for the project with the x handle or project name.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b5a48767-7705-4dd3-b96b-bee8145c7372).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Supported networks and eligibility checks

The public finder accepts a pasted Ethereum/Base/Robinhood Chain EVM address or Solana address. It scans OpenSea featured, upcoming, and recently minted listings using their pagination cursors (up to five pages per listing type and 80 results per wallet check). It loads each candidate's OpenSea drop details and omits a drop only when OpenSea reports a positive maximum supply and total supply at or above that maximum. If current supply or stage details are unavailable, the app marks the result unverified and links to OpenSea rather than assuming it is available. Provider listings are not an exhaustive catalog of every NFT project, may lag OpenSea, and can be capped; check the source link for the latest status.

Projects that mint on their own website can be added by the site owner in `/admin`: add the project, select its chain, and save its official website/mint URL. Choose **Check project site** when eligibility cannot be verified from a configured public list. This directs users to the official checker; Mint Finder does not automatically inspect arbitrary websites. For projects with an uploaded allowlist, the app can check the list directly and shows those results in a separate **Whitelist status** section so public mints are not confused with allowlist membership.

For OpenSea-gated EVM drops, the user can choose **Sign in with wallet to check**. This asks the browser wallet to sign OpenSea's login message for the connected address. The prompt identifies `opensea.io` and includes OpenSea's Terms of Service and Privacy Policy. It does not submit a blockchain transaction or ask for a seed phrase. OpenSea's `read:eligibility` scope is used; the temporary token is revoked after the request and is configured to expire after one day as a fallback. The wallet notice shows the current page host for comparison with Mint Finder's link from a trusted source. Wallet providers control their own site warnings, which Mint Finder cannot guarantee to suppress.

The admin tools are at `/admin`. Allowlist uploads accept EVM addresses for Ethereum, Base, and Robinhood Chain projects, and base58 addresses for Solana projects.

1. Apply the migrations in `supabase/migrations` to the Supabase project in filename order if they have not already been applied. The initial migration creates the tables and policies; `20261104180000_chain_aware_allowlist.sql` updates allowlist matching for Solana's case-sensitive addresses.
2. Configure these environment variables locally and in the hosting provider's secret settings:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only; never use a `VITE_` prefix)
   - `ADMIN_PASSWORD` (choose a private password with at least 16 characters; do not use the disclosed location word)
   - `ADMIN_SESSION_SECRET` (a random server-only secret with at least 32 characters)
   - `OPENSEA_API_KEY` (enables OpenSea drop discovery, holder checks, and gated eligibility checks)

   Use `.env.example` as a variable-name reference. Generate a session secret locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep actual values in `.env` and the hosting provider's server-side secret settings. Never commit them or expose the service-role key, admin password, session secret, or OpenSea key to browser code.

3. Run `npm run dev`. Choose **Public user active** → **Yes**, then enter the admin password to open the tools. The server verifies the password, creates an HTTP-only session cookie, and performs admin database changes server-side. The session expires after eight hours.

4. Add the same server-only variables to your production host before publishing. The local `.env` does not configure production.

The build is configured for Cloudflare Workers by default. Keep API keys in the host's secret store; never put the OpenSea key or a Supabase service-role key in client-side `VITE_` variables.
