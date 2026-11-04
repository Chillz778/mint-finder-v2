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

## Ethereum MVP setup

The public finder accepts a pasted Ethereum address; it does not connect to a wallet or request a signature. It checks public OpenSea drops and projects configured by the site owner. The admin tools are at `/admin`.

1. Apply `supabase/migrations/20261103230000_initial_schema.sql` to the Supabase project if it has not already been applied. It creates the tables and policies and disables first-signup admin promotion.
2. Configure these environment variables locally and in the hosting provider's secret settings:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only; never use a `VITE_` prefix)
   - `ADMIN_PASSWORD` (choose a private password with at least 16 characters; do not use the disclosed location word)
   - `ADMIN_SESSION_SECRET` (a random server-only secret with at least 32 characters)
   - `OPENSEA_API_KEY` (enables OpenSea drop discovery and NFT-holder checks)

   Use `.env.example` as a variable-name reference. Generate a session secret locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep actual values in `.env` and the hosting provider's server-side secret settings. Never commit them or expose the service-role key, admin password, session secret, or OpenSea key to browser code.

3. Run `npm run dev`. Choose **Public user active** → **Yes**, then enter the admin password to open the tools. The server verifies the password, creates an HTTP-only session cookie, and performs admin database changes server-side. The session expires after eight hours.

4. Add the same server-only variables to your production host before publishing. The local `.env` does not configure production.

The build is configured for Cloudflare Workers by default. Keep API keys in the host's secret store; never put the OpenSea key or a Supabase service-role key in client-side `VITE_` variables.
