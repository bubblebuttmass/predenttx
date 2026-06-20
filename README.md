# PreDentTX

A platform connecting Texas predental students with dentists/orthodontists offering shadowing opportunities and community events.

## Current state

This is a static, no-build-step site (plain HTML/CSS/JS, ES modules loaded straight from CDN). Currently wired to **Firebase** (Auth + Firestore) for data and login.

| File | Purpose |
|---|---|
| `index.html` | Landing page — search clinics or events by city |
| `login.html` | Combined login + signup, role picker (student/dentist) |
| `signup.html` | Standalone student signup page (overlaps with the signup flow already in `login.html` — needs reconciling, see Known Issues) |
| `student-profile.html` | Student dashboard — profile editor, application status tracker, notification bell |
| `dentist-profile.html` | Public clinic profile a student lands on to request a shadowing date |
| `dentist-dashboard.html` | Dentist dashboard — clinic profile editor, event posting, incoming requests, hours verification |

## Running locally

No build step required. Easiest options:
- VS Code "Live Server" extension, or
- `python3 -m http.server` from the project root, then visit `http://localhost:8000`

## Known issues / planned work

A full review turned up several things worth fixing before/while migrating off Firebase to Supabase:

- **Security**: client writes directly to Firestore with no visible security rules audit — needs Postgres RLS (or locked-down Firestore rules) so a request can't be submitted/approved by anyone but its actual participants.
- **Data leak**: the dentist dashboard's "Hours Pending Verifications" panel currently loads *all* clinics' pending logs, not just the logged-in dentist's.
- **Images stored as base64** directly in Firestore documents (profile pics, clinic photos, event posters) — should move to object storage with the document just holding a URL.
- **No email notifications** — students/dentists only find out about status changes if they reopen the app and check the bell icon.
- **`login.html` vs `signup.html`** — two separate signup paths exist; should be reconciled into one.
- **City search is exact-match** — typos or "Austin, TX" return nothing.
- No password reset flow, no email verification on signup.

A Supabase-based rebuild addressing these is in progress in a separate branch/conversation.

## Tech stack

- Vanilla HTML/CSS/JS (ES modules)
- Firebase Auth + Firestore (being migrated to Supabase)
