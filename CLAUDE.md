# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

``bash
npm run dev        # next dev
npm run build      # next build — run before assuming a change is deployable
npm run typecheck  # tsc --noEmit — the fastest correctness check
npm run lint       # eslint . — flat config in eslint.config.mjs
npm run package    # assemble .next/standalone for self-hosting (see below)
```

There is no test suite. `typecheck`, `lint` and a build are the only automated verification, so all three matter.

`lint` runs the ESLint CLI, not `next lint`: that command is deprecated in Next 15 and removed in 16, and ESLint was never actually a dependency here, so the old script only ever opened an interactive setup prompt. `eslint-config-next` is pinned to the same major as `next`.

`next dev` holds file handles on Windows: a `git mv` of a watched directory fails with `EACCES` until the dev server is stopped. Stale `.next` output after moving routes produces a misleading `Cannot find module for page: /x` at build time — delete `.next` and rebuild before investigating further.

## Architecture

### Elysia runs inside Next.js, not beside it

The whole API is one Elysia instance in `server/app.ts`, mounted at `app/api/[[...slugs]]/route.ts` by exporting `api.handle` for each HTTP method. It is never started with `.listen()`.

This is deliberate. Elysia targets Bun; Vercel's serverless runtime is Node. Because `.handle(request)` takes a standard `Request` and returns a `Response` — the same pair Next route handlers use — no Bun runtime is involved and the whole app deploys as a single Next.js project with one serverless function. Do not add a separate server process or a `listen` call.

Route modules live in `server/routes/` and are composed with `.use()` in `server/app.ts`. A new route module must be registered there or it silently does not exist.

`/auth/discord` and its callback are plain Next route handlers, not Elysia, because they return redirects and gain nothing from typed responses.

### Types flow from the server to the client

`server/app.ts` exports `type Api`. `lib/client/eden.ts` feeds that into Eden Treaty, and `lib/client/queries.ts` wraps each call. Renaming or changing a route is therefore a compile error in the client rather than a runtime 404 — keep it that way by adding new calls to `queries.ts` instead of hand-writing `fetch`.

Only the type crosses the boundary; no server code is bundled into the client.

One wrinkle: `/rules-data/:type` serves four different shapes behind one route, so Eden infers the union of all of them. `queries.ts` narrows each literal back to its real type via a local `narrow<T>()` helper. That cast is intentional and belongs only there.

The `rules` arm of that route is currently served but never asked for: the home page's กฎตำรวจ tab is `RulesLinkView`, a signpost to the city's Google Sites rulebook, so the sheet's own rules rows have no reader and no editor. The route, the `rules` sheet and `RulesType`'s `'rules'` member are all still in place — deliberately, because the data is still there — but nothing reaches them from the UI.

### Wire format

Inherited from the v2 Express API this project replaced:

- reads return the raw payload (an array or object)
- writes return `{ success, message, data }`
- failures return `{ error }` with a status code, produced centrally by `onError` in `server/app.ts`

Throw `ApiError(message, status)` from `server/errors.ts` rather than returning an error shape by hand.

### Data layer is positional

`server/services/csv.ts` and `server/services/roster.ts` map Google Sheets **by column index** (`NamePD` C=code D=name F=rank…, weekly sheets A=name J=totalCases X=paid, AC–AI=duty). The column comments are the only specification. Reordering a sheet column breaks parsing silently — values land in the wrong fields rather than erroring.

Large read-only sheets come through Google's GViz CSV export; writes and the rules/cases sheets use the Sheets API.

### Serverless constraints

- `server/services/cache.ts`, `paymentStore.ts`, and `server/rateLimit.ts` are **instance-local**. Multiple Vercel instances do not share them — rate limits and idempotency keys throttle/dedupe per-instance, not globally.
- Long-running work at module scope runs on every cold start; avoid adding any.

### The operational log is a spreadsheet, not memory

`services/opsLog.ts` appends to the `Log-Debug-web` tab of the bot's Settings
spreadsheet — the same file that holds the bot's `config`. `/police/logs` reads
it back, alongside the bot's own `Log-Debug-Bot` tab and the bot's live 24h
buffer over HTTP.

A buffer here would be pointless for the same reason `cache.ts` and
`rateLimit.ts` are instance-local: nothing in this runtime survives a request,
so "what happened an hour ago" would be answered with whatever one instance
happens to remember. Only lines worth keeping go to the sheet; the bot's verbose
debug stays in the bot's memory, where it costs nothing.

The constraint is write volume, not size. The bot and this app share one Google
service account and therefore one write quota — the quota the bot needs to
record case counts. Admin actions and errors are tens per day, which is nothing;
logging every request would not be, so `logEvent` also caps itself at 20 sheet
writes per minute per instance and says so in the next line that gets through.

Three things that look like details and are not:

- **`RAW`, never `USER_ENTERED`.** The latter turns `2026-10-02 03:47:11` into a
  Google date value, and reading it back returns the cell's *display* format
  ("3:47:11") rather than what was written. Retention walks those timestamps, so
  that mismatch silently stops cleanup forever. `parseLogTime` tolerates
  unpadded parts anyway, for rows written before this was understood.
- **Redaction happens on the way in.** Error text drags Google keys and Discord
  tokens along with it, and these rows land in a spreadsheet and on a page other
  admins open. Filtering at display time would mean the secret was already
  stored. The bot carries its own copy of `redact` — separate deploys, no shared
  module, so change both.
- **`logEvent` is awaited and never throws.** Fire-and-forget loses writes when
  an instance is frozen right after its response, and a failed log line must not
  turn a working request into an error.

Retention is trimmed when an admin opens the page, not on a schedule: there is
no scheduler here, and a cron hitting a route is more moving parts than a tab of
a few thousand rows justifies. The bot trims its own tab on its own timer.

### Rate limiting

`/register` and `/medical` are both rate-limited (10/min per client) via `rateLimit()` in `server/rateLimit.ts`, keyed by `clientKey` (best-effort from `X-Forwarded-For`) — apply the same call to any new public submission endpoint.

### Everything administrative authorises on a Discord allowlist. There is no PIN

`server/services/permissions.ts` is the only admin gate: the verified Discord id from the session cookie has to appear in a list the spreadsheet holds in two cells — the left one naming the list, the right one holding the ids (any separator, `<@id>` tolerated).

| list | gates | routes | key cell | ids cell | key |
|---|---|---|---|---|---|
| `ROSTER_MANAGE` | `/rostermanage`, `/police`, the conduct/fines CRUD, `/mark-paid` | `routes/rosterAdmin.ts`, `rules.ts`, `admin.ts` | `NamePD!AA2` | `AB2` | `ROSTERMANAGE_IDDC` |
| `PROCTOR` | `/proctor` | `routes/pending.ts` | `Pending!L1` | `M1` | `PROCTOR_IDDC` |

`ROSTER_MANAGE` is the site-wide admin list, not just its own console's: the same handful of people do all of it, so they are one list by choice rather than by accident. A group that should *not* overlap means adding a `PermissionSource`, not a second reader.

`requirePermission` returns the actor's id, so a write can be attributed — the thing one shared PIN never could. `/pending/approve` records it as the proctor instead of believing an id sent in the body, and `/mark-paid` logs who confirmed a payment.

Consequences worth knowing before changing it:

- **The list is not a credential.** An id only works for whoever can log into that Discord account, which is why it is safe in a sheet other people can read. A PIN would not be — never put one there, and note that removing `ADMIN_PIN` is what makes that distinction moot rather than merely observed.
- Read through the Sheets API, not GViz: the GViz export is CDN-cached, so a revoked id would keep working for minutes.
- Those cells are positional like the rest of the sheet layer, so the key cell is **verified** rather than assumed. An inserted row reports itself instead of silently reading whatever slid into AA2.
- Keep them clear of the data range. The proctor pair started at `I1/J1` and had to move to `L1/M1` the moment column I became a data column: a config cell inside the range arrives as a column header and ships the allowlist to the browser with every row.
- The diagnostic in `problem` names the sheet and the cell, so it is returned **only alongside `allowed`** and logged server-side. A refused caller is told nothing about where the list lives.
- `ROSTERMANAGE_IDDC` and `PROCTOR_IDDC` in the environment are standby lists, merged in on every path including the failure ones. They are what stops a mistyped cell from locking the last admin out of the page that edits that cell. They do not help if Discord OAuth itself breaks — and now that the PIN is gone, nothing else does either. That was the accepted cost of one attributable gate.
- Every page asks its `access` endpoint on load because the session cookie is HttpOnly. Without that call a refresh looks like a logout. On the public pages the call is cheap: with no session cookie the server answers without reading the sheet. The two consoles share `useAccessGate` in `components/forms/DiscordGate.tsx` for that; it takes the fetcher and an error sink, both of which must be stable references or it re-asks on every render.

On the client, `lib/client/adminAccess.ts`'s `useAdminGate()` is what pages ask. It keeps two facts apart deliberately: `allowed` (may this account edit) and a 30-minute localStorage flag (has the person switched editing on). The Discord session lasts a week, so without the second flag an admin would find edit controls on every page for days — the one thing the PIN session got right, by expiring. Neither flag authorises anything; the server re-reads the list on every call.

Returning from Discord OAuth to a page that carries its own query is why `fallbackPage` accepts `profile:<name>` and why `pageWithParams` exists — a login started from a profile has to come back to that officer, not to an empty profile page.

### Editing an application does not need its Discord message id

A submission's message id is written to `Pending!I` alongside the row, and `GET /register/mine` finds it from the Discord id in the session cookie. That is what lets someone edit an application they submitted on another device, or after losing the id the success screen told them to keep.

`RegisterForm` calls it the moment Discord connects, not only when the edit button is pressed: finding an earlier application drops the page straight into editing it, which is what stops a second one being filed. `refuseDuplicate` in the route is what actually enforces that — the editor can be left, and the API can be called without the page at all. It is keyed on the **stored message id**, not on having a row: an application filed before that id was recorded cannot be opened automatically, and refusing those would leave the applicant with no way through. It runs before anything is posted to Discord, so a refused submission leaves no message and no row.

Leaving the editor while an application is open means "discard my changes", not "start a new one": the cancel button re-reads the application instead of dropping to an empty form, which is how a second one used to get filed. Fourteen ids in the sheet already have more than one row. Status is deliberately not consulted — an approved or rejected applicant edits the same way anyone else does. Finding nothing is silent, because "no earlier application" is the normal case for a first-time applicant, not an error.

- The lookup takes the applicant's **most recent** row. Fourteen Discord ids in the sheet already appear more than once, because a rejected applicant can apply again — and an edit belongs to the application they last sent. `updatePendingRegistration` matches the same way, which is a fix: it used to write to the oldest.
- Rows written before column I existed have it empty. That reads as "not found" and the form falls back to asking for the id by hand, so nothing already submitted stops being editable — do not remove that field.
- `fetchRegistration` still verifies ownership against the Discord message itself. A sheet row is a weaker claim than the message, and the check costs nothing on a request that was already going to load the embed.
`/medical` works the same way against its own sheet, `Medical` (columns A–K, message id in K, row 1 headers), in the same spreadsheet. It has no review console yet: its status column is written on submit and read by nothing, so one can be added later without every column moving along.

`services/applicationSheet.ts` holds the part both share — find this Discord id's most recent row, and the message id beside it. A third application form means another `ApplicationSheet` descriptor, not another copy of the loop.

### Google Sheets lags its own writes

The GViz export is CDN-cached, so re-reading a week immediately after marking it paid can still report it unpaid. `components/profile/ProfileClient.tsx` keeps a `paidThisSession` ref that overrides re-fetched data. Payments also carry idempotency keys, and a request lost to the 10s timeout is resolved by querying `/api/mark-paid/status` rather than being reported as a failure — that machinery exists to avoid double-paying someone, so do not simplify it away.

### Self-hosting outside Vercel (DirectAdmin is the primary target)

`next.config.mjs` sets `output: 'standalone'`, so a build emits `.next/standalone` — the server plus only the dependencies it traced, runnable with `node server.js` and no install or build on the target host. That matters for panel hosting (DirectAdmin's Node.js Selector, cPanel), where `next build` routinely exceeds the available memory — always build locally and upload the assembled bundle, never build on the panel host itself.

`next build` deliberately leaves two things out of that folder, because on Vercel the CDN serves them:

- `.next/static` — omitting it serves the site with **no CSS or JS**
- `public/` — omitting it 404s the logo

`npm run package` copies both in, and also deletes the `.env` that `next build` bundles into `.next/standalone/.env` **with real secret values** — the host's own environment settings should supply those instead. Run `build` then `package`; uploading a bundle assembled by hand is how the missing-CSS failure reappears.

## Configuration

`SHEET_ID`, `CASES_SHEET_ID` and `RULES_SHEET_ID` are lazy getters in `server/config.ts` that throw when unset. A missing variable surfaces as a 500 naming the variable on the first request that needs it, not as a boot failure — so the site renders and only the affected endpoints fail. See `.env.example` for the full variable list.

`GOOGLE_JSON_KEY` holds the entire service-account JSON as a single-line string. A panel that writes environment variables into `.htaccess` as `SetEnv` truncates a value that long at its first space, which surfaces as `GOOGLE_JSON_KEY is not valid JSON` — there, leave it unset and point `GOOGLE_APPLICATION_CREDENTIALS` at the JSON file instead, keeping that file outside the web-served directory.

**Discord OAuth requires three things to agree exactly**: `APP_URL`, the host actually serving the site, and the redirect registered in the Discord Developer Portal. A mismatch — including `www` vs apex — makes Discord refuse to return from login, with no useful error. `redirectUri()` strips trailing slashes from `APP_URL` for this reason.

## Styling

Tailwind v4, configured CSS-first through `@theme` in `app/globals.css`. Design tokens were ported from the v2 stylesheet; prefer them over new literals.

**Do not create a color token whose name collides with a Tailwind utility scale.** A `--color-base` token generates a `text-base` color utility that collides with the built-in font-size utility, silently rendering text in the wrong color. This happened; the token is now named `night`.
