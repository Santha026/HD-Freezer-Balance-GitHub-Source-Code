# HD Freezer Balance Portal — deployment guide

A GitHub-deployable static HTML/CSS/JavaScript app backed by Supabase Auth and PostgreSQL. Admins upload **two Excel workbooks together**; all active authenticated users can search any HD Code and view HD balances. Uploaded files are parsed in the administrator's browser; only normalized records are saved to Supabase. Original Excel files are not stored or served to field users.

## 1. Prerequisites

- GitHub account (private repository recommended)
- Supabase account/project
- Netlify account **or GitHub Pages** (Netlify is easiest for static deployments)
- Modern browser and internet connection (SheetJS and Supabase libraries are loaded from CDNs)
- Two Excel workbooks matching the included `HD_Excel_Template.xlsx`

## 2. Create Supabase database

1. Go to https://supabase.com/dashboard and create a project.
2. Open **SQL Editor**, paste and run the complete `supabase.sql` file.
3. Open **Authentication → Providers** and ensure Email is enabled. Turn off public self-signup if only admins should issue accounts (depending on your Supabase dashboard version, check Auth settings).
4. Open **Authentication → Users → Add user**. Create the administrator and field accounts. Ensure emails are verified/confirmed as appropriate. Do not share passwords.
5. Copy each new user's UUID from the Auth Users screen. In SQL Editor, run (substitute the real UUID):

```sql
insert into public.profiles(user_id,role,active)
values ('ADMIN_AUTH_UUID','admin',true)
on conflict(user_id) do update set role='admin',active=true;

insert into public.profiles(user_id,role,active)
values ('FIELD_AUTH_UUID','field',true)
on conflict(user_id) do update set role='field',active=true;
```

6. For new field users, create their Auth user and insert a `field` profile. To deactivate a user, set `active=false` in `public.profiles`. Do not grant `admin` to field users.
7. Go to **Project Settings → API** (or the newer **Connect/API Keys** page). Copy the Project URL and the **publishable** key (legacy anon key is also supported). **NEVER** copy a service-role or secret key into this project.

## 3. Configure frontend

Open `config.js` and replace the two placeholder strings with your actual project URL and publishable/anon key. The publishable key is designed to be public; Supabase RLS protects the data. The project URL/key are not login credentials. Keep passwords private.

## 4. Test locally

Open `index.html` in Chrome/Edge. Sign in with your admin email/password. Upload both Excel files and click **Validate & replace cloud data**. The app checks headers, HD codes, duplicates, and foreign HD codes, then calls a protected Supabase RPC to atomically replace the dataset. Try searching one HD Code. Log out and sign in as a field user to verify the upload section is absent and search works.

> The current importer sends both datasets in **one database request**. For very large Excel workbooks, browser/network/request limits may cause failure. For production-scale imports (e.g. hundreds of thousands of rows), implement a backend streaming/batched import workflow. Keep backups of the original Excel files.

## 5. Push to private GitHub repository

1. Create a private repository at https://github.com/new, e.g. `hd-freezer-balance`.
2. Upload these **extracted files**, not the ZIP alone, using **Add file → Upload files**, then commit.
3. Or run in this folder:

```bash
git init
git add .
git commit -m "Initial HD Freezer Balance Portal"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/hd-freezer-balance.git
git push -u origin main
```

## 6. Deploy to Netlify from GitHub

1. Go to https://app.netlify.com → **Add new project** → **Import an existing project** → GitHub.
2. Authorize access to the private repository and select it.
3. This is a **static HTML** project: **Build command: leave empty**; **Publish directory: `.`** (repository root).
4. Deploy. Netlify will provide a `*.netlify.app` URL. GitHub remains private while the deployed frontend is accessible to visitors; only authenticated, active users can read the database.
5. Open the site, sign in as admin, upload the two Excel files, and test a field user on another device.
6. To update the site, commit changes to GitHub; Netlify redeploys automatically.

### Alternative: GitHub Pages

GitHub Pages can serve the same static files. Check GitHub's current private-repository Pages availability for your plan; repository visibility and website visibility are different. Supabase Auth/RLS still protects the data.

## 7. Excel columns

**Asset_Details**: `HD Code`, `Asset Tag Number`, `Asset Capacity`, `Asset Value`

**HD_Master**: `HD Code`, `HD Name`, `Location`, `RSM Name`, `ZSM Name`, `SDM Name`, `Total Deposit`, `Security Deposit`

Matching uses exact HD Code values, after trimming spaces. Keep HD codes stored as text in Excel, especially if they have leading zeroes. The importer recognizes several alternative header spellings. If your column headings differ, edit the `alias` mapping in `app.js`.

**Formula:** `Available Balance = Total Deposit − Security Deposit − Sum(Asset Value for the HD)`.

Capacity-wise summary groups by `Asset Capacity` and totals count/value. Asset tag details show up to 40 per page, arranged as 20 on the left and 20 on the right on wider screens. On narrow screens they stack to remain readable without horizontal scrolling.

## 8. Security & operational notes

- RLS permits `SELECT` only to **active authenticated** users; there are no direct client write policies.
- Upload uses `replace_hd_dataset`, a database function that checks `public.is_admin()` and performs replacement in one transaction.
- No admin password, secret key, or raw Excel workbook is included in public web files.
- The admin login is an ordinary Supabase Auth account; admin permissions are assigned in `profiles` by a database administrator.
- Any active field user can search **all** HD codes, per your chosen access policy.
- Protect personal/company financial data: use approved hosting, restricted signups, MFA where available, backups, and company security review before rollout.
- **This is a starter implementation**, not a certified production system. Test against your real Excel data and perform security/load review before wide deployment.
