# Multipl — Give Your Money a Side Hustle

Deployable React/Vite version of the Claude artifact.

## What has already been changed

- Replaced the code-generated header logo with the supplied Multipl logo.
- Preserved the existing interaction, visual design, QR generator, appointment letter and PNG download.
- Made the QR destination configurable.
- Made the final "Get the Multipl app" CTA a real external link.
- Added basic page title, favicon, description and social metadata.
- Added a standard Vite build so the site can be hosted independently of Claude.

## Run locally

1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run:

   npm install
   npm run dev

Vite will show a local URL, typically `http://localhost:5173`.

## Configure links

Copy `.env.example` to `.env` and edit:

- `VITE_QR_URL` — destination encoded into the generated QR code.
- `VITE_APP_URL` — destination of the "Get the Multipl app" button.

Then restart the dev server.

## Build for production

    npm run build

The production files will be created in `dist/`.

## Put it on your own domain with Vercel

1. Create a GitHub repository and upload this project.
2. Go to Vercel and import the repository.
3. Framework preset: Vite.
4. Build command: `npm run build`
5. Output directory: `dist`
6. Add the two environment variables from `.env.example` in Vercel.
7. Deploy.
8. In Vercel → Project → Settings → Domains, add your desired domain, for example:
   `hire.multipl.in`
9. Vercel will show the DNS record to add to your domain provider.

Once DNS propagates, the public URL will use your own domain and have no Claude branding.

## Before publishing

Please verify all hard-coded public claims and compliance copy in `src/App.jsx`, including:
- 1M+ downloads
- 100+ brand partners
- ₹1,000 joining bonus
- AMFI / ARN wording
- instant redemption wording
- campaign eligibility language
