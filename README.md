# Rata & Smudge app

A market till, brew planner and order tracker for Rata & Smudge, built as one web app that installs to the home screen on an iPad (Safari) and on Android (Chrome). Built to the "Rata & Smudge App — Build Playbook", reusing Family Screen's proven patterns.

**Status (7 Nov 2026):** Phase 1 (foundations) and the market till (brought forward from phase 3 at the owner's request) are written and pass 37 screen tests against a fake Firebase. Not yet connected to a real Firebase project or tried on the real iPad.

## What is in phase 1

- Google sign-in: redirect style on iPad, pop-up on Android, signing in through the app's own address so Safari allows it.
- Gate screens that always show the real reason and which Google account is signed in.
- Invite-only: only an invited account can set up a business, and each new business starts **empty**.
- People and roles: owner, manager (everything except people) and helper (sell only, the default).
- Setup PIN, stored as a hash, which locks again the moment Setup closes. "Forgot the PIN" works by the owner signing out and back in.
- Home dashboard with six big tiles; the screens for later phases say what they will do.
- Works offline (Firestore offline cache + service worker), with a "Saved on this device, will sync" marker.
- Updates itself within 5 minutes of a release, never while a pop-up or form is open.
- Install card: iPad gets written Share → Add to Home Screen steps; Android gets an Install button.
- Visible Back button on every screen (the iPad has none); Android's back button also works.
- Every text box at 18 px (no iPad zoom), safe-area spacing, NZ time zone throughout.
- Privacy page, download all data, delete the business (owner only).

## The market till

- **Products and prices** (Setup → What you sell): only the owner or a manager can set a price, and prices include GST. Paste a whole price list ("Name, size, price" per line) to load it in one go.
- **Deals**: "any N of these for $X", set up once and applied by the till itself, best price to the customer.
- **Selling day**: Market, Farm gate, Garden tour or Shop, with market name, cash float and who is serving.
- **Taking a sale**: tap products (tap again for more, − and ＋ to adjust), then Cash, EFTPOS or Other. Cash: tap the notes handed over and the change is shown. Saved at once, even offline. "Undo last sale" for one minute.
- **Hand to a helper**: locks the iPad to the till. No Back, no Setup, no way to type a price. Leaving till mode, voiding a sale or ending the day needs the owner's PIN.
- **Helpers on their own phone**: a Google account with the Helper role can sell and nothing else; the security rules enforce it.
- **End of the day**: takings, GST, deals given, EFTPOS total to match the terminal, cash expected against cash counted (shows over or short), voids, units by product.

## Files

| File | What it is |
| --- | --- |
| `src/app.html` | The app's screens. `npm run build` turns `src/` into `public/`, which Firebase Hosting serves. Don't edit `public/`. |
| `src/catalogue.js` | Products, paste-a-price-list, deals and the deal maths. |
| `src/till.js` | Selling days, the till, payments, till mode, voids, end of day. |
| `src/sync.js` | Sign-in and live sync with Firestore (adapted from Family Screen). |
| `firestore.rules` | Security rules: who can read and change what. |
| `firebase-config.json` | The project's web config (not a secret). Copy `firebase-config.example.json` and fill it in. |
| `test/screens.js` | Screen tests at iPad and Android sizes with a fake Firebase: `npm test`. |
| `test/rules.test.js` | Security-rule tests against the Firestore emulator (needs Java). |

## Setting it up (Tony)

1. **Admin account.** Choose the Google account that will run the app (it can invite new businesses) and make sure 2-Step Verification is on for it.
2. **GitHub.** Create a new **private** repository, e.g. `tony-aria-reyna/rata-smudge`, and upload this folder to it (or give Claude push access to it).
3. **Firebase project: `batch-sales-planner`** (already created; free Spark plan, no card needed). Check its **Project ID** in ⚙️ Project settings → General. If it isn't exactly `batch-sales-planner` (Firebase sometimes adds a suffix), replace that name in `.firebaserc`, `firebase-config.json` and the addresses below. Then:
   - ⚠️ **If this project already holds data for another app**, publishing these rules will lock that app out. These rules allow only `admins`, `invites` and `businesses`. Tell Claude first, so the rules can be merged.
   1. Project settings → Your apps → **Web** (`</>`) → nickname "Rata & Smudge" → leave "Firebase Hosting" unticked → Register. Copy the `firebaseConfig` values into `firebase-config.json` (use `firebase-config.example.json` as the template).
   2. Build → **Authentication** → Get started → Sign-in method → **Google** → Enable → support email → Save.
   3. Build → **Firestore Database** → Create database → location **australia-southeast1 (Sydney)** → **Production mode**.
   4. Firestore → **Rules** → replace everything with the contents of `firestore.rules` → **Publish**.
   5. **Make yourself the admin.** Firestore → Data → **Start collection** → Collection ID `admins` → Document ID = your Google email address, in lower case → add any field (e.g. `note` = `admin`) → Save. This is the only place the admin's address is stored; it is never in the code.
   6. Build → **Hosting** → Get started (just click through; the deploy comes from GitHub).
4. **Allow sign-in through the app's own address (needed for the iPad).** Google Cloud Console (console.cloud.google.com, same project) → APIs & Services → Credentials → OAuth 2.0 Client IDs → "Web client (auto created by Google Service)" → **Authorized redirect URIs** → add `https://batch-sales-planner.web.app/__/auth/handler` → Save.
5. **Automatic deploys.** On your PC, in this folder: `npm install`, then `npx firebase login`, then `npx firebase init hosting:github`. Answers: repository `tony-aria-reyna/batch-sales-planner`; build script before deploy **Yes**, `npm ci && npm run build`; deploy on merge **Yes**, branch `main`. It adds the workflow files and a secret to GitHub. Push, and the app appears at `https://batch-sales-planner.web.app`.
6. **First sign-in on the iPad** (the most important test): Safari → the address → Sign in → set up "Rata & Smudge" → Share → Add to Home Screen → open from the icon → sign in again.
7. **Lock the key** (only after step 6 works): Google Cloud Console → Credentials → Browser key → Website restrictions → `https://batch-sales-planner.web.app/*` and `https://batch-sales-planner.firebaseapp.com/*`. A typo here blocks everything with "permission-denied".
8. **Invite your mum.** In the app: Setup → Invites → her Google email if she is to own her own business, or Setup → People → add her as a manager on the one you set up. To make her the owner, set the business up while signed in as her.

## Testing

- `npm test` — screen tests (fake Firebase), screenshots in `test/shots/`.
- `npx firebase emulators:exec --only firestore "node test/rules.test.js"` — rule tests (needs Java and `npm i --no-save @firebase/rules-unit-testing`).
- Before calling a phase done: the checklist in the playbook, on the real iPad and the real Android phone.
