// Records the ~90 s TrustLens demo video with Playwright (installed Edge).
// Needs the API (:8000) and web app (:5173) running with the saved scans.
// Usage (from demo/video):  npm i playwright@1.48.2 && node record.mjs
// Output: demo/video/out/*.webm (convert to mp4 with make_mp4.py)
import { chromium } from 'playwright'

const APP = 'http://localhost:5173'
const W = 1280, H = 720
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const FONT = `<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">`
const BASE = `
  *{box-sizing:border-box;margin:0}
  html{background:#fffaf3;height:100%;overflow:hidden}
  body{width:${W}px;height:${H}px;background:#fffaf3;color:#2b2118;font-family:"Source Sans 3",sans-serif;
       display:flex;flex-direction:column;justify-content:center;padding:0 110px}
  h1{font-family:"Bricolage Grotesque",sans-serif;font-weight:800;font-size:64px;letter-spacing:-1.5px}
  h2{font-family:"Bricolage Grotesque",sans-serif;font-weight:800;font-size:40px;letter-spacing:-1px;margin-bottom:22px}
  .o{color:#e8590c}
  p.lead{font-size:28px;color:#5c4d40;margin-top:18px;max-width:900px;line-height:1.35}
  .fade{opacity:0;transform:translateY(10px);animation:in .5s ease forwards}
  @keyframes in{to{opacity:1;transform:none}}
`

function card(body, extraCss = '') {
  return `<!doctype html><html><head><meta charset="utf-8">${FONT}<style>${BASE}${extraCss}</style></head><body>${body}</body></html>`
}

const TITLE = card(`
  <svg width="64" height="64" viewBox="0 0 32 32" class="fade"><circle cx="14" cy="14" r="9" fill="none" stroke="#e8590c" stroke-width="3.5"/><path d="M21 21l7 7" stroke="#e8590c" stroke-width="3.5" stroke-linecap="round"/><path d="M10 14.5l2.6 2.6L18 11.5" fill="none" stroke="#e8590c" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <h1 class="fade" style="margin-top:18px;animation-delay:.2s">TrustLens</h1>
  <p class="lead fade" style="animation-delay:.6s">Installing a package means running a stranger’s code.
  You trust its README. <b class="o">TrustLens checks whether the README is telling the truth</b>,
  before you install it.</p>`)

const STEPS = [
  ['1', 'Get the package', 'npm, PyPI, or upload a .zip. Nothing runs yet.'],
  ['2', 'Read the README', 'Write down what it promises to do.'],
  ['3', 'Run it in a sandbox', 'Install it, load it, run its examples, record everything.'],
  ['4', 'Compare', 'Every action vs. the promises: in the README, or not?'],
  ['5', 'Run it 5 ways', 'Normal, CI, future date, other host, other user. Did it change?'],
]
const WORKFLOW = card(`
  <h2>How it works</h2>
  <div class="steps">${STEPS.map(([n, t, d], i) => `
    <div class="step fade" style="animation-delay:${0.3 + i * 0.9}s">
      <div class="n">${n}</div><div><div class="t">${t}</div><div class="d">${d}</div></div>
    </div>`).join('')}
  </div>`, `
  .steps{display:flex;flex-direction:column;gap:10px}
  .step{display:flex;align-items:center;gap:22px;background:#fff;border:1px solid #efe4d6;border-radius:16px;padding:10px 22px}
  .n{width:44px;height:44px;border-radius:50%;background:#e8590c;color:#fff;display:grid;place-items:center;font:700 22px "Bricolage Grotesque"}
  .t{font-size:24px;font-weight:600}.d{font-size:19px;color:#7a6a5b}`)

const SANDBOX = card(`
  <h2>The sandbox: a sealed glass room with a camera</h2>
  <div class="row">
    <div class="room fade" style="animation-delay:.3s">
      <div class="lbl">fresh Linux container, deleted after every run</div>
      <div class="pkg">📦 the package</div>
      <div class="cam">🎥 recorder inside Node / Python logs every<br>connection, file, env variable and program</div>
    </div>
    <ul class="walls">
      <li class="fade" style="animation-delay:1.2s">✂️ <b>No internet.</b> It can try to connect, but can’t reach anything.</li>
      <li class="fade" style="animation-delay:2.2s">🔒 <b>None of your files.</b> Only its own copy is inside.</li>
      <li class="fade" style="animation-delay:3.2s">🧯 <b>No admin, limited memory &amp; CPU.</b> Can’t take over the machine.</li>
      <li class="fade" style="animation-delay:4.2s">📝 <b>The log</b> is compared with the README afterwards.</li>
    </ul>
  </div>`, `
  .row{display:flex;gap:46px;align-items:center}
  .room{flex:0 0 430px;height:340px;border:4px solid #e8590c;border-radius:22px;background:#fff;position:relative;padding:58px 28px 28px;display:flex;flex-direction:column;gap:22px}
  .lbl{position:absolute;top:-16px;left:22px;background:#fffaf3;padding:0 10px;color:#c2410c;font-weight:600;font-size:17px}
  .pkg{font-size:30px;font-weight:600}.cam{font-size:19px;color:#5c4d40;background:#fff0e3;border-radius:12px;padding:14px}
  .walls{list-style:none;padding:0;display:flex;flex-direction:column;gap:18px;font-size:22px;line-height:1.3}`)

const CLOSING = card(`
  <h1 class="fade">Trust, but <span class="o">verify</span>.</h1>
  <p class="lead fade" style="animation-delay:.5s">Install it. Run it. Watch it. Compare it with its own README, five ways.<br>
  Every flag explains itself, in plain words.</p>
  <p class="lead fade" style="animation-delay:1.2s;font-size:22px;color:#7a6a5b">npm + PyPI · registry or upload · fully offline sandbox · no AI deciding the verdict</p>`)

// Cards are written next to the app and opened over http: about:blank +
// setContent renders at a different scale in the recording (grey border).
import { mkdirSync, writeFileSync } from 'node:fs'
const CARD_DIR = new URL('../../web/public/video-cards/', import.meta.url)
mkdirSync(CARD_DIR, { recursive: true })
async function showCard(page, name, html) {
  writeFileSync(new URL(name + '.html', CARD_DIR), html)
  await page.goto(`${APP}/video-cards/${name}.html`)
  await page.waitForLoadState('networkidle')
}

async function caption(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById('tl-cap')
    if (!el) {
      el = document.createElement('div')
      el.id = 'tl-cap'
      el.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);max-width:1000px;z-index:9999;' +
        'background:#2b2118;color:#fffaf3;font:600 21px "Source Sans 3",sans-serif;line-height:1.35;padding:14px 22px;' +
        'border-radius:14px;border-left:6px solid #e8590c;box-shadow:0 8px 30px rgba(0,0,0,.18);transition:opacity .3s'
      document.body.appendChild(el)
    }
    el.style.opacity = '0'
    setTimeout(() => { el.textContent = t; el.style.opacity = '1' }, 250)
  }, text)
}

async function show(page, scan, tab = 'diff') {
  await page.goto(`${APP}/?scan=${encodeURIComponent(scan)}&tab=${tab}`)
  await page.waitForSelector('h2', { timeout: 10000 })
  await sleep(600)
}

const browser = await chromium.launch({ channel: 'msedge' })
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: 'out', size: { width: W, height: H } } })
const page = await context.newPage()

// 0:00 – 0:08 title
await showCard(page, 'title', TITLE); await sleep(5500)
// 0:08 – 0:20 workflow
await showCard(page, 'workflow', WORKFLOW); await sleep(10500)
// 0:20 – 0:32 sandbox
await showCard(page, 'sandbox', SANDBOX); await sleep(9500)

// 0:32 – 0:40 clean package
await show(page, 'pad-clean@1.0.0')
await caption(page, 'pad-clean: its README says it touches nothing. We ran it in the sandbox. It touched nothing → fine.')
await sleep(7500)

// 0:40 – 0:50 undocumented network call
await show(page, 'http-fetchy@1.0.0')
await caption(page, 'http-fetchy: left is what the README promises, right is what it actually did. It calls a server the moment you load it, and never says so → suspicious.')
await sleep(8500)

// 0:50 – 0:58 install-time program
await show(page, 'postinstall-probe@1.0.0')
await caption(page, 'postinstall-probe: a byte formatter that runs a program while installing. That’s how most real npm attacks start.')
await sleep(7500)

// 0:58 – 1:12 hidden trigger
await show(page, 'ci-sleeper@1.0.0')
await caption(page, 'ci-sleeper looks almost clean… but we run every package 5 ways.')
await sleep(4500)
await page.getByRole('button', { name: 'Hidden triggers' }).click()
await sleep(500)
await caption(page, 'Only when it thinks it’s on a CI build server does it call home. Its README says “no network access” → dangerous.')
await sleep(8000)

// 1:12 – 1:20 python + evasion
await show(page, 'py-titlecase@1.0.0')
await caption(page, 'Python works too. py-titlecase does the opposite: it goes quiet in CI, so a CI-only check would miss it.')
await sleep(7500)

// 1:20 – 1:27 real packages + bring your own
await show(page, 'express@4.21.1')
await page.getByRole('button', { name: 'npm/PyPI' }).click()
await page.getByPlaceholder(/npm:axios/).fill('npm:express@4.21.1')
await caption(page, 'Real packages too: type any npm or PyPI name, or upload a .zip. Express (69 dependencies) comes back clean apart from minor debug settings.')
await sleep(7000)

// 1:27 – 1:33 closing
await showCard(page, 'closing', CLOSING); await sleep(4500)

await context.close()
await browser.close()
console.log('saved video in demo/video/out/')
