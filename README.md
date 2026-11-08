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

- **Products and prices** (Setup → What you sell): only an owner or manager can set a price, and prices include GST. **Load a price list** reads a PDF, Excel or CSV file on the device (nothing is uploaded), then shows new products, price changes (old → new), unchanged ones and products missing from the list, each with a tick box, before anything changes. Re-loading an updated list updates prices in place, matched by name and size. Photos are refused: not reliable enough for prices.
- **Deals**: "any N of these for $X", set up once and applied by the till itself, best price to the customer.
- **Selling day**: Market, Farm gate, Garden tour or Shop, with market name, cash float and who is serving.
- **Taking a sale**: tap products (tap again for more, − and ＋ to adjust), then Cash, EFTPOS or Other. Cash: tap the notes handed over and the change is shown. Saved at once, even offline. "Undo last sale" for one minute.
- **Hand to a helper**: locks the iPad to the till. No Back, no Setup, no way to type a price. Leaving till mode, voiding a sale or ending the day needs the owner's PIN.
- **Helpers on their own phone**: a Google account with the Helper role can sell and nothing else; the security rules enforce it.
- **End of the day**: takings, GST, deals given, EFTPOS total to match the terminal, cash expected against cash counted (shows over or short), voids, units by product.

## Emailed GST receipts

After a sale, **📧 Email a GST receipt** (on the green "Payment approved" screen, or 📧 against a sale in Sales) records the customer's address. A free Google helper script running in the **business Gmail** checks every 5 minutes, builds the receipt from the saved sale and sends it from that Gmail as "Rata & Smudge". Requests made with no signal wait on the device and go up when it reconnects.

Receipts show the business name, GST number, date, receipt number (RS-YYYYMMDD-XXXXX), items, total excluding GST, GST and total including GST, and how it was paid. That meets IRD's taxable supply information requirements up to $1,000; over $1,000 the app also asks for the customer's name.

Set-up, once:
1. **Owner, in the app:** Setup → GST receipts → enter the **GST number** and the **business Gmail** address.
2. **Tony, Google Cloud console** (console.cloud.google.com, project batch-sales-planner) → IAM & Admin → IAM → **Grant access** → New principals: the business Gmail → roles **Cloud Datastore User** and **Service Usage Consumer** → Save. This lets the helper read sales and mark receipts sent.
3. **Signed in as the business Gmail**, open **script.google.com** → **New project** → name it "Rata & Smudge receipts".
4. Replace the contents of `Code.gs` with [`helper/Code.gs`](https://raw.githubusercontent.com/tony-aria-reyna/batch-sales-planner/main/helper/Code.gs).
5. ⚙️ **Project Settings** → tick **Show "appsscript.json"** → back in the editor, replace `appsscript.json` with [`helper/appsscript.json`](https://raw.githubusercontent.com/tony-aria-reyna/batch-sales-planner/main/helper/appsscript.json) → **Save**.
6. Choose **setup** in the function list → **Run** → **Review permissions** → choose the business Gmail. Google warns it's unverified (it's your own script): **Advanced → Go to Rata & Smudge receipts → Allow**.
7. Choose **sendTestReceipt** → **Run**. A sample receipt arrives in the business Gmail.
8. In the app, Setup → GST receipts should now say **✓ Last checked … min ago**.

Gmail allows about 100 emails a day from a free account, plenty for a market stall.

## Voice notes (Gemini)

Mum taps **🎙 Talk** (or uses **🚗 Drive mode**), speaks, and taps **Done**. The business helper sends the recording to
Gemini on the business's own key and gets back draft calendar entries, to-dos, shopping and ideas. They appear as
ordinary forms: anything can be fixed by hand, guessed fields are yellow, clashes are flagged, and nothing is saved
until she taps Save. Recordings are deleted as soon as they are understood (and never kept past a day). Helpers can
only make their own to-dos and shopping. "What's on today" in Drive mode is read aloud by the iPad itself (free).

Set-up (once, after the GST receipt helper is working, because it is the same script):
1. Signed in as the business Gmail, go to aistudio.google.com → **Get API key** → create a key in a new project
   called "Rata & Smudge voice". Turn on billing for it (paid tier: Google does not use the content to improve its
   products) and set a budget alert, e.g. NZ$10 a month, in Google Cloud → Billing → Budgets & alerts.
2. In the helper script: paste the latest `helper/Code.gs` and `appsscript.json`, then **Project Settings → Script
   properties → Add**: `GEMINI_API_KEY` = the key. Optional: `GEMINI_MODEL` (default `gemini-3.8-flash`) and
   `VOICE_MONTHLY_LIMIT` (default 600 notes a month).
3. **Deploy → New deployment → Web app**, execute as *Me*, access *Anyone*. Copy the address ending in `/exec`.
   (The address only tells the helper "a note is waiting"; it reads the note itself from the database, so it
   can only act on notes a signed-in member has saved.)
4. Run `setup()` again once, and allow the new permissions.
5. In the app: **Setup → 🎙 Voice assistant → Switch on**, and paste the web address. Without the address, notes
   are still worked out, but only at the 5-minute check.
6. Siri: in the Shortcuts app, make a shortcut "Rata note" that opens the Rata & Smudge home-screen app, then tap
   **🎙 Talk**. (Apple doesn't let home-screen web apps use live speech recognition, which is why the note is
   recorded and sent to Gemini.)

## Shopify orders

The business helper copies new Shopify orders into **Orders** every 15 minutes (read-only: it never changes
Shopify). Lines are matched to till products by name; anything that doesn't match is linked once in the app and
remembered. Stock comes off when an order is packed in the app, or when Shopify says it was sent.

Set-up (once), in her Shopify admin:
1. Store name (top left) → **Dev Dashboard** → **Create app**, name "Rata & Smudge orders". App URL:
   `https://shopify.dev/apps/default-app-home`. Access scopes: `read_orders`, `read_products`. Release the version,
   then **Install** it on her store. (It must be in the same Shopify organisation as the store.)
2. From the app's **Settings**, copy the **Client ID** and **Client secret** into the helper script's Script
   properties as `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`. (Optional: `SHOPIFY_API_VERSION`, default 2026-07.)
3. In the app: **Setup → Shopify** → type the shop address ending in `.myshopify.com`.
4. In the script editor, run `checkShopifyNow()` once; the last check shows in Setup → Shopify and on Orders.

## Notifications and the market report email

The business helper (version 5 or later) sends web push through Firebase Cloud Messaging every 5 minutes:
calendar reminders (the evening before, and an hour before), a 7:30 am list of today's markets and to-dos,
"till still open" nudges, new Shopify orders, and low stock the evening before a market. Each person chooses
what they get under 🔔 Notifications. When the last till at a market closes, owners are emailed a one-page report.

Set-up (once):
1. Firebase console → ⚙️ Project settings → **Cloud Messaging** → Web configuration → Web Push certificates →
   **Generate key pair**. Copy the key into the app: Setup → 🔔 Notifications → Web push key.
2. Google Cloud console → IAM → find the **business Gmail** account (the one running the helper) → Edit →
   Add role **Firebase Cloud Messaging API Admin** → Save. (Check APIs & Services shows "Firebase Cloud Messaging
   API" enabled.)
3. Paste the latest `helper/Code.gs` into the helper script and save.
4. On each device: open the app (on the iPad, from its Home Screen icon) → 🔔 Notifications → Turn on, then
   "Send a test".

## Files

| File | What it is |
| --- | --- |
| `src/app.html` | The app's screens. `npm run build` turns `src/` into `public/`, which Firebase Hosting serves. Don't edit `public/`. |
| `src/catalogue.js` | Products, paste-a-price-list, deals and the deal maths. |
| `src/till.js` | Selling days, the till, payments, till mode, voids, end of day. |
| `src/sync.js` | Sign-in and live sync with Firestore (adapted from Family Screen). |
| `firestore.rules` | Security rules: who can read and change what. |
| `firebase-config.json` | The project's web config (not a secret). Copy `firebase-config.example.json` and fill it in. |
| `helper/Code.gs` | The Google helper script that emails GST receipts from the business Gmail. |
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

## Assistant v2 and summaries (business helper version 6)

Paste the latest `helper/Code.gs` into the helper project, then **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** (same web address). Nothing else to set up: it uses the same `GEMINI_API_KEY`.

- Notes are written down first (the words appear in the app), then worked out with a short business summary and the lessons learnt. Thinking is kept low for speed.
- Replies change the drafts on screen; "yes", "cancel" and "later" work by voice or typing.
- New kinds: questions, made, stock counts, costs, fill-ups, shops and contacts, ingredient prices, recipes. Photos are read in one go.
- Each evening after 9 pm it turns what people changed into short lessons (Setup → Voice assistant → What it has learnt). Never costs, pay or recipe amounts.
- Summaries by email to the owners (Setup → Summaries): a daily briefing only on days with something on, weekly, monthly and yearly. Default 7 am.
