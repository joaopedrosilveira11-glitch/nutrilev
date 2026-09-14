# Nutri IA

Nutri IA is a production-oriented mobile web application for personal meal planning, calorie tracking, hydration, and AI-guided nutrition support. Supabase is the source of truth for authenticated user data; localStorage is used only as an offline cache.

## Product summary

Nutri IA helps users:
- Track calories and macronutrients
- Plan daily meals across breakfast, snacks, lunch, dinner, and evening snack
- Log foods and hydration quickly
- Discover recipes based on goal and time constraints
- Get personalized meal suggestions from an AI nutrition assistant
- Monitor progress with weight, trends, and weekly nutrition reports

The experience is intentionally simple, modern, and polished: premium health-tech UX without clutter.

## Safety design

Nutri IA includes a clear safety boundary:
- AI is described as a nutrition assistant, not a substitute for a doctor or registered dietitian
- Recommendations are educational and general guidance only
- Medical diagnosis or unsafe dietary advice is blocked by product safeguards
- If a user reports a medical condition, the assistant should steer them toward a qualified health professional

## Architecture overview

The app is designed around a modular client-server architecture:
- Mobile UI for meal planning, logging, recipes, AI assistant, and progress
- API layer for auth, nutrition, goals, recipes, AI, progress, and notifications
- Nutrition engine for calorie and macro calculations
- Recipe and food database with verified nutritional metadata
- AI orchestration layer using user profile + goal + meal context + food database + safety rules
- Notification service for reminders and strea
- Analytics and reporting services for daily and weekly insights

### Code structure

Shared browser code is organized by responsibility:

```text
mobile/          Mobile navigation and shell configuration
student/         Student-only route constants
auth/            Roles and authentication helpers
nutrition/       Nutrition feature contract
workout/         Workout feature contract
progress/        Progress feature contract
academy/         Academy and invitation feature contract
notifications/   Push notification feature contract
ai/              Nutri IA feature contract
services/        Supabase, data access, push and deep-link services
components/      Shared UI primitives
hooks/            Session and lifecycle hooks
utils/            Escaping and general utilities
types/           Shared domain contracts
```

Feature modules expose route/service contracts only; Supabase access remains
in the shared `services/` layer. This keeps Web and Android on the same API,
authentication, RLS and business data path instead of creating mobile-only
implementations.

The application does not use fake accounts, seeded dashboard numbers or local
mock records to simulate backend behavior. Empty and unavailable states are
shown until real Supabase data is available. Local storage is restricted to
per-user offline cache, pending synchronization actions and a pending
deep-link invitation; it is not a replacement database.

## Android technology decision

The current Nutrilev frontend is a modular HTML, CSS and JavaScript application,
with shared browser modules under `services/`, `hooks/`, `features/` and
`student/`. It is not a React application, so introducing React or React Native
would require rewriting the existing student experience and duplicating the
Supabase integration.

For that reason, the Android app uses **Capacitor + the existing web student
area**. This keeps the current UI, Supabase client, Auth session handling,
database queries and RLS behavior shared between web and Android while
providing an installable native Android container. Capacitor also keeps the
project compatible with Android APK builds today and AAB/Google Play
publishing later.

React Native/Expo is intentionally not used: the current requirements do not
need a separate native rendering layer, and adopting it would reduce code
reuse and increase maintenance without a corresponding product benefit.

## Product structure

The product remains organized into three surfaces:

```text
NUTRILEV
├── Landing Page
├── Web
│   ├── Aluno
│   ├── Coach
│   └── Administrador
└── Android
    └── Aluno
```

The Android package is intentionally an **aluno-only** application in this
initial release. The Web version remains the only surface for Coach and
Administrador accounts. The mobile shell sets `NUTRILEV_MOBILE_APP`, forces the
student role for its navigation, and validates the authenticated Supabase
profile before loading student data; non-student profiles are signed out and
shown an access message.

## App identity

The Android app keeps the official Nutrilev identity used by the web surfaces:

- App name: **Nutrilev**
- Description: **Alimentação, Treino e Evolução**
- Official green leaf logo from `assets/logo-icon.png`
- Light Nutrilev splash background (`#F7FBF3`)
- Deep green and brand green theme colors shared with the web UI
- Android adaptive launcher icons for regular and round launchers

The launch theme shows the official Nutrilev logo while the WebView starts,
followed by the existing student loading skeleton. No separate mobile brand,
logo or color system is introduced.

## Mobile navigation

The Android student app uses a dedicated fixed bottom navigation with five
high-frequency destinations:

- Início
- Alimentação
- Treino
- Evolução
- Perfil

The navigation is intentionally limited to these destinations for quick
one-handed access. The Web experience keeps its existing sidebar navigation for
Aluno, Coach and Administrador; the Android bottom bar is only enabled when
`NUTRILEV_MOBILE_APP` is active.

The student home dashboard summarizes the shared daily data from Supabase:
calorie target, consumed and remaining calories, protein, carbohydrates, fats,
water, today's assigned workout, latest body evaluation and linked academy.
When a specific macro is not available in the existing nutrition record, the
dashboard shows `—` instead of inventing a value.

The Alimentação area uses the existing `foods`, `meals`, `meal_items` and
`nutrition_entries` tables. Students can choose Café da manhã, Lanche,
Almoço, Lanche da tarde, Jantar, Ceia or Outras; search the shared food
catalog with a mobile-optimized partial search, quick results, recent and most
used foods, favorites, quantity and unit, then edit or remove today's food
records. Favorites are stored per student in `food_favorites` with RLS. The
catalog service is structured so barcode lookup, packaged products and meal
image recognition can be added as new data sources without changing the meal
recording flow.
The migration `supabase/migrations/20260911212000_student_nutrition_crud_policies.sql`
adds the required user-scoped update and delete policies.

The AI meal entry accepts natural language such as
`150 g de arroz, 100 g de feijão e 120 g de frango`. The `food_search` Edge
Function uses AI only to interpret food, quantity, unit and meal type, then
queries Open Food Facts for nutrition data. The app shows the returned source
values and requires explicit confirmation before saving. If any item has no
trusted match, the whole confirmation is blocked; no calorie or macro value is
invented by the client.

### Android identity

The Android package keeps the Nutrilev web identity instead of creating a
separate mobile brand:

- Application name: `Nutrilev`
- Description: `Nutrilev — Alimentação, Treino e Evolução`
- Official leaf logo reused from the web assets
- Adaptive launcher icon in `mipmap-anydpi-v26`
- Branded launch screen with the Nutrilev green palette
- Android 12+ splash configuration plus a compatible pre-Android 12 launch
  background

The source assets are kept in the Android resources and are not loaded from a
network during application startup.

The mobile shell is optimized for touch rather than simply displaying the Web
layout in a WebView: it uses five-item bottom navigation, safe-area insets,
44px minimum interactive targets, responsive cards, 16px form controls to
avoid unwanted Android zoom, subtle pressed states, and `visualViewport`
keyboard detection that hides the bottom bar while the keyboard is open. The
HTML viewport uses `interactive-widget=resizes-content` so forms remain
visible above the virtual keyboard.

## Main screens
- Home dashboard
- Daily log
- Recipes discovery
- AI assistant
- Progress overview
- User profile and settings

## Running locally

Because this is a front-end prototype, you can open `index.html` directly in a browser.

For a local static web server:

```bash
cd C:\Nutrilev
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

## Android app

The Android app is a Capacitor shell around the same `www/` student area. It
uses the same Supabase URL, publishable key, Auth session, RLS policies and
database as the web app; no mobile-only backend or account store is created.
Only profiles with the `student` role can enter the installed app.

The mobile access screen supports email/password login, student account
creation, password recovery through Supabase Auth, session persistence and
logout. Supabase stores the persisted session in the Android WebView's
application-isolated storage under the app-specific key
`nutrilev.auth.session`; access tokens are never hardcoded in the app. A
non-student account is signed out and directed to the Web platform for Coach
or Administrator access.

Install the Android SDK and JDK 21, then run the debug build:

```powershell
npm run android:apk:dev
```

The generated file is `Nutrilev-debug.apk`. For a signed production artifact,
copy `android/keystore.properties.example` to `android/keystore.properties`,
fill in the release keystore values, and run:

```powershell
npm run android:apk
npm run android:aab
```

The release commands generate `Nutrilev-release.apk` and
`Nutrilev-release.aab`; the AAB is the artifact intended for Google Play.
The application ID is `com.nutrilev.app`. Version code and name default to
`2` and `1.0.1` in `android/gradle.properties` and can be overridden per build
without editing files:

```powershell
.\build-apk.ps1 -Format apk -BuildType release -VersionCode 3 -VersionName 1.0.2
.\build-apk.ps1 -Format aab -BuildType release -VersionCode 3 -VersionName 1.0.2
```

Release builds require a local `android/keystore.properties` and keystore, or
the `NUTRILEV_KEYSTORE_FILE`, `NUTRILEV_KEYSTORE_PASSWORD`,
`NUTRILEV_KEY_ALIAS` and `NUTRILEV_KEY_PASSWORD` environment variables. Keep
the keystore outside the repository and its passwords in a password manager or
CI secret store. Do not add
`google-services.json`, service-role keys, FCM credentials or other private
secrets to the Android assets.

## Files
- `index.html` — public landing page entry point
- `app.html` — Android/mobile student app shell
- `platform.css` and `platform.js` — shared student platform UI and data orchestration
- `PRODUCT_SPEC.md` — product, UX, architecture, API, and safety specification
- `supabase_schema.sql` — Supabase-ready PostgreSQL schema with Auth integration and RLS
- `.env.example` — environment variable template
- `supabase/functions/nutri-ai/index.ts` — Gemini-backed AI Edge Function
- `landing.html` and `landing.css` — public product landing page
- `landing-auth.js` — account, checkout, and protected APK download flow
- `supabase/functions/marketplace/index.ts` — Mercado Pago checkout/webhook and signed download URL
- `PRIVACY_POLICY.md` — prepared privacy policy for the Web and Android app

## Supabase database setup

1. Create a Supabase project.
2. Open **SQL Editor** and run `supabase_schema.sql` for the full schema bootstrap.
3. If you already applied the RLS policies directly in the linked database, keep the versioned copy in `supabase/migrations/20260901_add_nutriia_rls_and_user_sync.sql` so the security model is documented and repeatable.
4. Configure the client with the project URL and publishable/anonymous key.

The schema uses `auth.users`, creates an application profile automatically after signup,
and restricts user-owned data through Row Level Security policies.

The migration `20260912001000_data_security_audit.sql` enables an internal,
client-inaccessible audit trail for important changes to nutrition, hydration,
workout, attendance and academy-membership records. Apply it together with the
other versioned migrations before production use.

For production teams, prefer applying database changes through migrations instead of ad hoc SQL runs.

## Environment variables

Copy `.env.example` to `.env` and fill in your Supabase project values:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-supabase-publishable-or-anon-key
```

The publishable/anonymous key is intended for client applications protected by RLS.
Never expose `SUPABASE_SERVICE_ROLE_KEY` or an AI provider secret in browser code;
keep those values in a server-side Edge Function or backend environment.

## Gemini AI assistant

The AI assistant is implemented as a Supabase Edge Function. Set the Gemini secret
server-side and deploy it:

```bash
supabase secrets set GEMINI_API_KEY=your-gemini-key
supabase secrets set GEMINI_MODEL=gemini-2.5-flash
supabase functions deploy nutri-ai
```

See `supabase/functions/README.md` for the request/response contract, supported actions,
safety behavior, and provider abstraction.

## Notes

The browser client never contains the Gemini secret or Supabase service-role key. AI requests go through the authenticated `nutri-ai` Edge Function. Apply the migrations in `supabase/migrations` before testing persistence.

Accounts created on the landing page use the same Supabase Auth project and session
storage as the app. Apply `20260908_223000_sync_landing_accounts.sql` so the Auth
trigger also creates the shared `public.users` and `user_settings` records with the
user's name.

The app also checks the approved `apk_purchases` record before opening the home
screen. New accounts created inside the app are sent to the same R$ 25,00/month Mercado
Pago checkout; accounts without an approved purchase cannot use the app.

## APK checkout

The landing page does not expose `index.html` or a public APK link. A user must create
an account, start the R$ 25,00/month Mercado Pago subscription, and wait for activation
webhook before receiving a short-lived signed URL.

1. Apply `supabase/migrations/20260908_220000_apk_store.sql`.
2. Upload `Nutrilev-debug.apk` to the private Storage bucket `app-downloads` with the
   object name `Nutrilev-debug.apk`.
3. Configure and deploy the marketplace function:

```bash
supabase secrets set MERCADOPAGO_ACCESS_TOKEN=APP_USR-your-production-token
supabase secrets set LANDING_URL=https://your-domain.example/landing.html
supabase functions deploy marketplace
```

If the object has another name, configure it before deploying:

```bash
supabase secrets set APK_OBJECT_NAME=Nutrilev-release.apk
```

Use the Mercado Pago test users and test cards while validating the flow. The
`SUPABASE_SERVICE_ROLE_KEY` is used only by the Edge Function and must never be placed
in `landing-auth.js` or any other browser file.

The Android student app now includes a Meu treino screen with the assigned workout of the day, exercises, sets, repetitions, load, rest and coach notes. Workout rest intervals are stored in workout_exercises.rest_seconds by migration 20260911224000_workout_rest_seconds.sql.
Students can execute the assigned workout from Android: each exercise can be marked
complete with performed sets, repetitions and load, a rest countdown is available,
and finalizing the workout stores the duration and exercise performance in
workout_logs. Migration 20260911225000_student_workout_logs_policy.sql grants the
authenticated student insert policy required by this flow.
The progress screen includes workout history with date, duration and exercise
performance, plus per-exercise comparisons of load, sets and repetitions across
completed sessions.
Its visual evolution dashboard also summarizes current weight, BMI when height
and weight are available, measurements, weight history, training frequency and
completed workouts with simple mobile-friendly charts and cards.

The Android student app now includes hydration tracking with a 2,500 ml daily goal, +200/+300/+500 ml quick actions, and a persisted daily history from hydration_entries.

The student app now includes Minha Academia with code or invite-link onboarding, a future QR Code extension point, and linked academy details: logo, coach, current workout, 30-day frequency, latest check-in and evolution.
Frequency records are read from `checkins` and displayed with their timestamp and
source. The app does not implement facial recognition; external academy systems
can send facial, QR or manual events through an API/Webhook, which Nutrilev then
exposes to the student. Migration `20260911232000_student_checkins_policy.sql`
allows students to read only their own check-in records.

Push notifications use the Capacitor Push Notifications plugin and register real
Android FCM tokens in `push_tokens`; they are not simulated interface messages.
The `send-push` Edge Function delivers notifications through FCM HTTP v1. Before
production, add Firebase `google-services.json` for `com.nutrilev.app`, apply
`20260911233000_push_tokens.sql`, deploy `send-push`, and configure its
`FCM_PROJECT_ID` and short-lived `FCM_ACCESS_TOKEN` secrets. The service-role key
remains server-side only.
