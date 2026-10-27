# TrustLens demo script (about 4 minutes)

## Before you present

1. Open Docker Desktop and wait for "Engine running" (bottom left). Don't install updates.
2. In one terminal, from the TRUSTLENS folder:
   `python -m uvicorn api.main:app --port 8000`
3. In a second terminal:
   `npm --prefix web run dev`
4. Open http://localhost:5173. All four packages should already be in the left list (saved results).
5. Do one practice scan so Docker is warm.

If anything breaks live, the saved results in `scans/` still show every screen below. Never depend on the live scan.

## 1. The problem (30s)

"When you `npm install` a package, you trust it runs only what its README says. Attacks like event-stream and ua-parser-js broke that trust: the code did things the docs never mentioned, sometimes only in CI. TrustLens runs a package in a locked sandbox and checks what it *does* against what it *says*."

## 2. A clean package (30s)

Click **pad-clean** → verdict **Matches its README**.
"Its README says pure function, no network, no files, no env. We ran install, import and the README example in the sandbox. It did nothing else. Green."

## 3. Undocumented network call (45s)

Click **http-fetchy** → **Suspicious**.
- Left column: what the README claims (`net:example.test`, `env:FETCHY_TIMEOUT`).
- Right column: what it did. Both claims are marked *claimed*, but `net:status.http-fetchy.test` during **import** is *unclaimed, HIGH*.
"An HTTP client making requests is normal, but only when you call it. This one phones home the moment you `require` it."
Show the **Timeline** tab: the call happens 0.4s after import, before any user code.

## 4. Install-time command (30s)

Click **postinstall-probe** → **Suspicious**.
"A byte formatter. README says no setup. During `npm install` it ran an install script, which ran `uname`. Install-time commands are how most npm attacks start."

## 5. The hidden trigger (60s, the highlight)

Click **ci-sleeper** → **Dangerous**, with the red Hidden trigger banner.
"In the normal run it looks almost clean. But TrustLens runs every package five times: normal, CI, a future date, a different hostname, a different user. Under `CI=true`, and only then, it calls `beacon.ci-sleeper.test`. Its README says no network access, so that's a direct contradiction."
Open the **Hidden triggers** tab: the matrix shows that capability only in the `ci` column.

## 5b. Python too, and evasion (30s)

Click **py-titlecase** → **Dangerous**, with the amber Evasion banner.
"Same pipeline for Python. It phones home on import even though its README says no network, and it goes *quiet* under CI, so a CI-only scanner would miss it. TrustLens flags both directions."

## 5c. Real packages: no false alarms (30s)

Click **dotenv@16.4.5** (tagged "real npm package") → **Matches its README**.
"These six are real, popular npm packages pulled from the registry: left-pad, ms, is-number, slugify, nanoid, dotenv. All come back clean. dotenv is the interesting one: it reads a `.env` file and several `DOTENV_CONFIG_*` variables, and its README says so, so every row is *claimed*. TrustLens flags what's undocumented, not what's merely powerful."

## 5d. Bring your own package (45s, if judges ask)

In the scan panel pick **npm / PyPI** and type e.g. `npm:express@4.21.1` (69 dependencies,
about a minute), or pick **upload** and choose a `.zip`/`.tgz` of a package folder or a `.whl`.
"Dependencies are downloaded first without running anything, then the whole install happens
offline inside the sandbox, so even dependency install scripts are observed."
Express comes back **Minor gaps**: a few undocumented debug env vars, and `listen:3000` is
*claimed* because its README example starts a server.

## 6. Live scan (45s)

Pick `fixtures/ci-sleeper` in the dropdown → **Scan**. The five steps light up one by one (~50s). Talk over it:
"Each step is a fresh container: no network, no capabilities, read-only filesystem, memory and process limits. A hook inside Node records every connection attempt, file read, env read and process. The diff is deterministic rules, no AI deciding the verdict."
When it finishes, the result opens on its own.

## 7. Close (15s)

"Install, import, README example, five environments, one verdict, and every flag explains itself. That's TrustLens."

## Likely judge questions

- **Can malware detect the sandbox?** Yes, a determined package could. The variants make the common checks (CI, date, host, user) visible instead of hiding them.
- **Why no network?** Safety. The hook still records every attempt and its destination, even though the connection fails.
- **What about Python?** Supported: an audit-hook based Python sandbox feeds the same event format and diff engine (see py-titlecase).
- **False positives?** We scanned six real npm packages (left-pad, ms, is-number, slugify, nanoid, dotenv): all clean. Category priors allow normal behaviour (an HTTP client fetching when called). Each flag shows its reason, so a human can judge it quickly.
