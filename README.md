# Happiness Hub — Setup &amp; Deployment Guide

This guide assumes no coding background. Follow the steps in order. It should take about 15–20 minutes the first time.

## What you already have

Your Google Sheet (with the `Products`, `Orders`, `Agents`, `Sellers`, `Settings`, and `Activity_Logs` tabs) and your Google Drive folder for uploaded photos are already set up and linked inside the code — you don't need to create or configure either one.

---

## Step 1 — Update the backend (Google Apps Script)

1. Open your Google Sheet.
2. Click **Extensions → Apps Script**. This opens the script editor in a new tab.
3. You'll see a file called `Code.gs` in the left sidebar (or a default blank one). Select **all** the existing code in the editor and delete it.
4. Open the `backend/Code.gs` file from this delivered zip, select all, copy it, and paste it into the empty Apps Script editor.
5. Press **Ctrl+S** (or **Cmd+S** on Mac) to save.
6. At the top of the editor, find the function dropdown (it may say "doGet") and change it to **setupSheets**.
7. Click the **Run** button (▶) next to it.
8. The first time you run anything, Google will ask for permission:
   - Click **Review Permissions**
   - Choose your Google account
   - You may see a warning screen that says "Google hasn't verified this app" — this is normal for your own scripts. Click **Advanced**, then **Go to (your project name) (unsafe)**, then **Allow**.
9. Once it finishes, click **View → Logs** (or the "Execution log" panel) — you should see a message like `Setup complete`. This confirms your sheet now has every column the app needs, without touching any of your existing data.

You can re-run `setupSheets` any time in the future — it's always safe and never deletes or duplicates anything.

## Step 2 — Deploy the backend as a Web App

1. In the Apps Script editor, click **Deploy → Manage deployments** (top right).
2. If a deployment already exists, click the **pencil/edit icon** next to it.
   - If none exists yet, click **Deploy → New deployment** instead, choose type **Web app**, and fill in the description.
3. Under "Version," choose **New version**.
4. Make sure "Execute as" is set to **Me** and "Who has access" is set to **Anyone**.
5. Click **Deploy**.
6. Copy the **Web app URL** shown (it ends in `/exec`).

> ⚠️ **Important:** If you already had a working site before, this URL should stay exactly the same as long as you used "Manage deployments → edit existing" rather than "New deployment." Creating a brand-new deployment generates a **different** URL and will break your live site until you update Step 3 below. Only create a new deployment on purpose (and then make sure to complete Step 3).

## Step 3 — Confirm the frontend points to the right URL

1. Open `frontend/lib/hh.js` in a text editor.
2. Find the line near the top that looks like:
   ```js
   const API = 'https://script.google.com/macros/s/AKfycb.../exec';
   ```
3. If the URL you copied in Step 2 is different from this one, replace it here (keep the quotes).
4. Save the file.

If the URL didn't change, you can skip this step entirely.

## Step 4 — Put the website on GitHub

1. Go to [github.com](https://github.com) and log in (create a free account if you don't have one).
2. Click the **+** icon (top right) → **New repository**.
3. Give it a name (e.g. `happiness-hub`), leave it **Public** or **Private** (either works), and click **Create repository**.
4. On the new repository page, click **uploading an existing file**.
5. Drag in the entire `frontend` folder, the `backend` folder, `vercel.json`, and this `README.md` from the delivered zip.
6. Scroll down and click **Commit changes**.

## Step 5 — Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign up or log in (you can sign in directly with your GitHub account).
2. Click **Add New… → Project**.
3. Find the repository you just created and click **Import**.
4. Vercel should auto-detect the settings from `vercel.json`. You don't need to change anything — just click **Deploy**.
5. After a minute, Vercel will give you a live URL (something like `happiness-hub.vercel.app`). That's your website.

## Step 6 — Smoke test everything

Visit your new Vercel URL and walk through this checklist:

1. Go to `/admin/login.html` → click **Enter Dashboard** → go to **Products** → click **+ Add Product** and fill in a test product with a direct image link (e.g. one ending in `.jpg` or `.png`) → confirm the live preview shows the image → **Save Product**.
2. Go to the homepage (`/`) → confirm your test product appears → click it.
3. Complete the 3-step order wizard (use a real or test order number, pick any refund method, and upload any small image as proof).
4. After submitting, click **Go to My Orders**, confirm your order shows up with a "📸 Action needed" banner.
5. Upload a delivery photo on that banner — confirm the status flips to "Delivered" automatically.
6. Back in the admin dashboard, go to **All Orders**, find your test order, click **Update**, set the status to **Cashback Sent**, and add a refund proof link. Save.
7. Go back to **My Orders** as the buyer and confirm you now see "💸 Cashback Sent!" with a working link to the refund proof.

If every step above works, your site is live and ready for real users.

---

## Everyday usage notes

- **Whenever you edit the backend code again:** repeat Step 2 (Deploy → Manage deployments → pencil icon → New version → Deploy). Never use "New deployment" unless you intend to change the URL.
- **Admin access** is just the one link (`/admin/login.html`) — there's no password, so don't share that link publicly.
- **Agents and Sellers** are created from the Admin dashboard (Agents / Sellers tabs) — each gets login credentials you set when adding them.
- **Buyers** never need an account. Their WhatsApp number is their identity for "My Orders" and order tracking.

## Troubleshooting

- **"Product Not Found" errors:** Run `setupSheets` again from the Apps Script editor, then try again.
- **Uploads failing:** Confirm the Drive folder (already configured in the code) is still shared as "Anyone with the link can view." Individual file sharing errors are handled automatically and won't block uploads.
- **Site shows old data after a backend change:** Make sure you redeployed using "Manage deployments → pencil icon → New version," not just saved the script.
- **CORS / network errors in the browser console:** This almost always means the `/exec` URL in `frontend/lib/hh.js` doesn't match your current deployment URL — recheck Step 3.
