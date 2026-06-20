# PreDentTX — Firebase hardening pass: setup guide

This covers everything needed to deploy the security rules, Storage migration,
and email notifications added in this pass. Run these once.

## 0. Install the Firebase CLI (if you haven't already)

```
npm install -g firebase-tools
firebase login
```

This opens a browser to sign into the same Google account your Firebase
project (`predenttx-a18a0`) lives under.

From inside this folder, link the CLI to the existing project:

```
firebase use --add
```

Pick `predenttx-a18a0` from the list when prompted.

## 1. Deploy the Firestore + Storage security rules

```
firebase deploy --only firestore:rules,storage
```

This is the single most important step — without it, the app still works
exactly the same for a well-behaved client, but nothing stops a malicious
one from writing arbitrary data. `firestore.rules` and `storage.rules` are
already written and sitting in this folder.

## 2. Enable Storage (if this project hasn't used it before)

Firebase Console → Storage → "Get started" → keep the default location →
done. The `media` bucket convention (`{uid}/avatar-*`, `{uid}/clinic-*`,
`{uid}/event-*`) is handled automatically by `uploadMedia()` in
`firebase-config.js`; you don't need to create folders manually.

## 3. Set up email notifications (Resend + Cloud Functions)

You said Blaze is already on, so this part just needs:

1. Create a free account at **resend.com** (no credit card required for the
   free tier — 100 emails/day, 3,000/month).
2. Grab an API key: Resend dashboard → API Keys → Create.
3. From the `functions/` folder:
   ```
   cd functions
   npm install
   cd ..
   firebase functions:secrets:set RESEND_API_KEY
   ```
   (paste the key when prompted)
4. Deploy the function:
   ```
   firebase deploy --only functions
   ```

By default, emails send from `onboarding@resend.dev` (Resend's shared
sandbox address — works immediately, but looks unpolished). Once you've
verified your own domain in Resend (Domains → Add Domain → add the DNS
records they give you), update `FROM_EMAIL` in `functions/index.js` to
something like `"PreDentTX <notifications@predenttx.com>"` and redeploy.

## 4. Turn on email verification + password reset in Firebase Auth

These use Firebase's built-in flows — no extra service needed — but two
things need to be set in the console:

- **Authentication → Settings → Authorized domains**: add the domain you're
  actually hosting the site on (e.g. `predenttx.com`, or your Firebase
  Hosting URL, or even `localhost` while testing). The password reset link
  in `reset-password.html` only works on a domain that's listed here.
- **Authentication → Templates**: you can customize the wording/branding of
  the verification and password-reset emails here if you want — optional,
  but worth doing before this goes out to real users.

## 5. First-time Firestore index prompts

The new prefix-match city search (in `index.html`) and the events query use
compound queries that need composite indexes. Firestore doesn't make you
create these manually — the first time you run a search that needs one,
the browser console will show an error with a direct link that creates the
index for you in one click. Run a clinic search and an event search once
after deploying, click through any index-creation links that appear, and
wait ~1-2 minutes for them to finish building.

## 6. Update the GitHub repo

From your local `predenttx-repo` folder, replace the existing files with
the ones in this delivery, then:

```
git add -A
git commit -m "Firebase hardening: security rules, Storage migration, email notifications, auth fixes"
git push
```

## What changed, file by file

| File | What's new |
|---|---|
| `firebase-config.js` | New — single shared client config + `notify()` + `uploadMedia()` helpers |
| `firestore.rules` | New — enforces who can read/write each collection |
| `storage.rules` | New — owner-folder-only writes, 5MB image limit |
| `functions/` | New — Cloud Function that sends email via Resend |
| `firebase.json` | New — ties rules + functions (+ optional Hosting) together |
| `login.html` | Email verification on signup, forgot-password flow, shared config |
| `reset-password.html` | New — handles the password reset link |
| `signup.html` | Now redirects to `login.html` (the redundant standalone flow is retired) |
| `index.html` | Prefix-match city search instead of exact-match, SEO meta tags |
| `dentist-profile.html` | Booking now requires login; uses your real account instead of a typed email; emails the dentist on submit |
| `student-profile.html` | Avatar uploads go to Storage instead of base64; queries by your account instead of email; new "Log Shadowing Hours" feature |
| `dentist-dashboard.html` | All image uploads go to Storage; events use a real date/time field; hours-verification inbox is now scoped to your own clinic only (this was the data leak); emails the student on accept/decline |
