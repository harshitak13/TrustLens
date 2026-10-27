# TrustLens, explained simply

## The one-line pitch

**TrustLens checks whether a code package does what its README says, and nothing else, before you install it.**

## The problem

When you run `npm install something` or `pip install something`, you are running a stranger's code
on your computer. You trust it because the README says "this pads strings" or "this makes HTTP
requests". Real attacks (event-stream, ua-parser-js) broke that trust: the package secretly did
something else, sometimes only on build servers, so normal testing never saw it.

## How TrustLens works, in 5 steps

1. **Get the package.** You type a name (`npm:express@4.21.1`, `pypi:requests==2.32.3`) or upload a
   `.zip` / `.tgz` / `.whl`. TrustLens downloads it and everything it depends on, **without running any of it**.
2. **Read the README.** It writes down what the package *promises*: "talks to example.test",
   "reads FETCHY_TIMEOUT", "never uses the network", and so on.
3. **Run it in a sandbox.** It installs the package, loads it, and runs the README's own examples,
   inside a locked box (explained below), while recording everything the package does.
4. **Compare.** Every recorded action is checked against the promises:
   - **in the README** → fine
   - **normal for this kind of package** → fine (e.g. an HTTP library making a request when you call it)
   - **not mentioned anywhere** → flagged
   - **the README says it doesn't do this** → flagged hard
5. **Try to catch it hiding.** It runs everything **five times**: normally, pretending to be a CI
   build server, with the clock set to the future, with a different computer name, and as a different
   user. If something only happens (or only stops happening) in one of those runs, the package is
   reacting to where it thinks it is. That's a strong sign of malware.

The result is one verdict: **fine, minor, worth a look, suspicious or dangerous**, and every
flagged line says *why* in plain words.

## The sandbox, in plain words

Think of it as **a sealed glass room with a camera inside.**

- **The room (a Docker container).** A brand-new, empty Linux computer is created for every run and
  thrown away right after. Nothing the package does survives.
- **The walls (the lockdown).**
  - **No internet.** The network cable is cut. The package can *try* to connect somewhere, but it
    can't actually reach anything, so it can't steal or send data.
  - **No access to your files.** It only sees its own copy of the package. Your home folder,
    passwords and other projects aren't in the room.
  - **No admin powers, limited memory and CPU.** It can't take over the machine or crash it.
- **The camera (the hook).** Before the package's code starts, TrustLens slips a small recorder into
  Node.js (or Python). Every time the package tries to **connect to a website, open a file, read an
  environment variable, or start another program**, the recorder writes a line in a log, even if
  the attempt fails.

When the run ends, TrustLens reads the log and compares it with the README.

**What the camera can't see:** if the package starts another program (like `curl`), we see *that*
it started it and with what command, but not what that program does inside. And because there's no
internet, we see *where* it tried to send data, not *what* it would have sent.

## Full workflow of the project

```
 You                     TrustLens on your laptop                         Sandbox (Docker)
 ───                     ────────────────────────                         ────────────────
 type a name or   ──▶  1. intake: download / unzip, no code runs
 upload a file          2. fetch dependencies, no code runs
                        3. read README + package.json → "promises"
                        4. start 5 sandboxes ─────────────────────────▶  install the package
                                                                          load it (import)
                                                                          run README examples
                                                                          camera logs every action
                        5. read the 5 logs  ◀──────────────────────────
                        6. compare actions vs promises → status + severity per line
                        7. compare the 5 runs → hidden triggers / evasions
                        8. save result (scans/*.json)
 see it in the UI ◀──   9. API serves it to the web page
```

| Part | Folder | What it does |
|---|---|---|
| Web page | `web/` | The orange screen you click around in |
| API | `api/` | Starts scans, streams progress, serves results |
| Intake | `sandbox/intake.py` | Turns a name or upload into a package folder, safely |
| Sandbox runner | `sandbox/run_scan.py` | Fetches dependencies, starts the Docker sandbox |
| Cameras | `sandbox/node/node-hook.js`, `sandbox/python/sitecustomize.py` | Record what the package does |
| Promise reader | `claims/parse.py` | Reads the README |
| Judge | `diff/` | Compares actions with promises, picks the verdict |
| Test packages | `fixtures/` | Harmless packages that act like real attacks |

## Demo flow (about 4 minutes, live)

**Before you start:** Docker Desktop says "Engine running"; both servers are running
(`python -m uvicorn api.main:app --port 8000` and `npm --prefix web run dev`); http://localhost:5173 is open.

1. **The problem (30s).** "Installing a package means running a stranger's code. We trust the README.
   TrustLens checks whether the README is telling the truth."
2. **A clean package: `pad-clean` (20s).** Green **fine**. "Its README says it touches nothing. We ran it.
   It touched nothing."
3. **A sneaky one: `http-fetchy` (30s).** **Suspicious.** Left: what the README promises. Right: what it
   did. "It connects to `status.http-fetchy.test` the moment you load it. The README never mentions that."
4. **An install trick: `postinstall-probe` (20s).** **Suspicious.** "A number formatter that runs a
   program during install. That's how most real npm attacks start."
5. **The hidden trigger: `ci-sleeper` (45s, the highlight).** **Dangerous**, red banner. Open
   **Hidden triggers**. "Normally it looks clean. But when it thinks it's on a build server, and only
   then, it calls home. Its README says 'no network access'."
6. **Python too: `py-titlecase` (20s).** **Dangerous**, amber banner. "Same idea for Python. This one
   does the opposite: it goes quiet in CI, so a CI-only scanner would miss it."
7. **Real packages, no false alarms: `dotenv` (20s).** **Fine.** "We scanned real popular packages
   (express, axios, requests, dotenv…). They come back clean or minor, because what they do is documented."
8. **Bring your own (30s).** Click **Upload**, pick `demo/uploads/ci-sleeper.zip`, click **Check this
   package**. The five dots light up (~1 minute) and it comes back **dangerous**. Or type
   `npm:express@4.21.1` in the **npm/PyPI** tab.
9. **Close (15s).** "Install it, run it, watch it, compare it with its own README, five ways. Every
   flag explains itself. That's TrustLens."

## Questions people ask

- **Is it safe to run malware like this?** The package runs only inside the sealed room, with no
  internet and none of your files. Downloading never runs any of its code.
- **Can malware fool it?** A determined attacker could detect the sandbox or hide inside a compiled
  program. The five-run trick catches the most common hiding tricks (CI, date, machine name, user).
- **Does AI decide the verdict?** No. The verdict comes from fixed, explainable rules.
- **Websites or apps?** No. TrustLens is for npm and Python packages.
