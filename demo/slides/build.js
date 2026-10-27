// TrustLens hackathon deck: 7 slides in the organisers' order, styled after the
// Canva "Orange and Beige Minimalist Project Proposal" template.
// Run: node build.js  ->  TrustLens-deck.pptx (import into Canva: Create a design > Import file)
const pptxgen = require('pptxgenjs')
const path = require('path')

const BG = 'F7F1E8', ORANGE = 'D9502B', INK = '2B2118', MUTED = '74665A', CARD = 'FFFFFF', LINE = 'EADCCB', SOFT = 'FBE3D6'
const HEAD = 'Montserrat', BODY = 'Arial'

const pres = new pptxgen()
pres.layout = 'LAYOUT_16x9' // 10 x 5.625 in
pres.title = 'TrustLens'
pres.theme = { headFontFace: HEAD, bodyFontFace: BODY }

// Shared frame: beige page, two small dots top-left, wordmark top-right, faint cube line-art, page number.
pres.defineSlideMaster({
  title: 'TL_CONTENT',
  background: { color: BG },
  objects: [
    { ellipse: { x: 0.5, y: 0.32, w: 0.07, h: 0.07, fill: { color: ORANGE }, line: { color: ORANGE } } },
    { ellipse: { x: 0.62, y: 0.32, w: 0.07, h: 0.07, fill: { color: ORANGE }, line: { color: ORANGE } } },
    { text: { text: 'TrustLens', options: { x: 7.9, y: 0.22, w: 1.6, h: 0.3, fontFace: HEAD, fontSize: 10, bold: true, color: ORANGE, align: 'right', margin: 0 } } },
  ],
  slideNumber: { x: 9.2, y: 5.2, w: 0.4, h: 0.25, fontFace: BODY, fontSize: 9, color: MUTED, align: 'right' },
})

function cubes(slide, x, y, s) {
  // Faint isometric cube outlines, the template's background motif.
  for (const [dx, dy] of [[0, 0], [s * 0.87, s * 0.5], [0, s], [s * 0.87, s * 1.5]]) {
    slide.addShape(pres.shapes.HEXAGON, { x: x + dx, y: y + dy, w: s, h: s * 0.87, rotate: 90,
      fill: { type: 'none' }, line: { color: 'EFD8C9', width: 0.75 }, objectName: 'cube' })
  }
}

function title(slide, text) {
  slide.addText(text, { x: 0.5, y: 0.55, w: 9, h: 0.75, fontFace: HEAD, fontSize: 32, bold: true, color: ORANGE,
    margin: 0, isTextBox: true, objectName: 'title' })
}

function card(slide, x, y, w, h, fill = CARD) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.08, fill: { color: fill },
    line: { color: LINE, width: 0.75 }, objectName: 'card' })
}

function circleNum(slide, x, y, n, d = 0.42) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: ORANGE }, line: { color: ORANGE } })
  slide.addText(String(n), { x, y, w: d, h: d, fontFace: HEAD, fontSize: 13, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0, isTextBox: true })
}

// ── 1. Title ────────────────────────────────────────────────────────────────
{
  const s = pres.addSlide({ masterName: 'TL_CONTENT' })
  cubes(s, 7.0, 2.6, 0.9)
  s.addText('TRUSTLENS.', { x: 0.5, y: 1.25, w: 8, h: 1.1, fontFace: HEAD, fontSize: 60, bold: true, color: ORANGE, margin: 0, isTextBox: true })
  s.addText('Does a package do what it says it does?', { x: 0.5, y: 2.35, w: 7, h: 0.45, fontFace: BODY, fontSize: 18, color: INK, margin: 0, isTextBox: true })
  const meta = [
    ['Problem statement', 'PS 1: Trust Nothing, Provenance for Your Own Dependencies'],
    ['Team', '[Team name]'],
    ['Members', '[Member 1, Member 2, Member 3]'],
  ]
  meta.forEach(([k, v], i) => {
    s.addText([{ text: k, options: { fontSize: 10, color: MUTED, breakLine: true } },
      { text: v, options: { fontSize: 13, bold: true, color: ORANGE } }],
    { x: 0.5, y: 3.35 + i * 0.62, w: 6.3, h: 0.55, fontFace: BODY, margin: 0, valign: 'top', isTextBox: true })
  })
  s.addNotes('Hi, we are [team]. We picked Problem Statement 1, Trust Nothing. Our tool is TrustLens: it checks whether a package actually does what its README says, before you install it.')
}

// ── 2. Problem ──────────────────────────────────────────────────────────────
{
  const s = pres.addSlide({ masterName: 'TL_CONTENT' })
  title(s, 'THE PROBLEM.')
  s.addText([
    { text: 'npm install = running a stranger’s code.', options: { bold: true, fontSize: 20, color: INK, breakLine: true } },
    { text: 'You trust the README. Attackers know that.', options: { fontSize: 15, color: MUTED } },
  ], { x: 0.5, y: 1.4, w: 4.3, h: 1.1, fontFace: BODY, margin: 0, valign: 'top', isTextBox: true })
  s.addText([
    { text: 'Today’s scanners match known-bad signatures, so a ', options: {} },
    { text: 'brand-new', options: { bold: true, color: ORANGE } },
    { text: ' malicious package gets through.', options: {} },
  ], { x: 0.5, y: 2.75, w: 4.3, h: 0.9, fontFace: BODY, fontSize: 15, color: INK, margin: 0, valign: 'top', isTextBox: true })
  s.addText('Real cases: event-stream (2018) stole crypto wallets; ua-parser-js (2021) installed a miner and password stealer through an install script.',
    { x: 0.5, y: 3.85, w: 4.3, h: 0.9, fontFace: BODY, fontSize: 12, color: MUTED, margin: 0, valign: 'top', isTextBox: true })

  const attacks = [
    ['Typosquatting', 'a look-alike name: “reqeusts” vs “requests”'],
    ['Dependency confusion', 'a public package wins over your private one'],
    ['Malicious install scripts', 'code runs the moment you type npm install'],
  ]
  attacks.forEach(([h, d], i) => {
    const y = 1.4 + i * 1.12
    card(s, 5.3, y, 4.2, 0.92)
    circleNum(s, 5.5, y + 0.25, i + 1)
    s.addText([{ text: h, options: { bold: true, fontSize: 15, color: INK, breakLine: true } },
      { text: d, options: { fontSize: 12, color: MUTED } }],
    { x: 6.1, y: y + 0.12, w: 3.25, h: 0.7, fontFace: BODY, margin: 0, valign: 'middle', isTextBox: true })
  })
  s.addNotes('Installing a package runs someone else’s code on your machine. Supply-chain attacks like typosquatting, dependency confusion and malicious install scripts work because developers cannot quickly tell whether a package behaves differently from what it claims. Existing scanners look for known-bad signatures, so new attacks slip through.')
}

// ── 3. Our idea ─────────────────────────────────────────────────────────────
{
  const s = pres.addSlide({ masterName: 'TL_CONTENT' })
  title(s, 'OUR IDEA.')
  s.addText([
    { text: 'Don’t ask “is this known to be bad?”', options: { color: MUTED, breakLine: true } },
    { text: 'Ask “does it do what it says?”', options: { color: ORANGE, bold: true } },
  ], { x: 0.5, y: 1.35, w: 9, h: 0.8, fontFace: HEAD, fontSize: 20, margin: 0, isTextBox: true })

  const rows = [
    ['', 'Signature scanners', 'TrustLens'],
    ['Looks at', 'Code patterns of known attacks', 'What the package actually does when run'],
    ['Compares with', 'A list of past malware', 'The package’s own README and metadata'],
    ['New attacks', 'Missed until someone reports them', 'Caught if behaviour doesn’t match the claims'],
    ['Hiding tricks', 'Not checked', 'Runs it 5 ways: normal, CI, future date, other host, other user'],
  ]
  s.addTable(rows.map((r, i) => r.map((c, j) => ({
    text: c,
    options: {
      bold: i === 0 || j === 0, color: i === 0 && j === 2 ? 'FFFFFF' : j === 2 && i > 0 ? INK : i === 0 ? INK : MUTED,
      fill: { color: i === 0 && j === 2 ? ORANGE : j === 2 ? SOFT : CARD },
    },
  }))), { x: 0.5, y: 2.3, w: 9, colW: [1.6, 3.2, 4.2], rowH: 0.48, fontFace: BODY, fontSize: 12, valign: 'middle',
    border: { type: 'solid', pt: 0.75, color: LINE }, margin: [0, 0.1, 0, 0.1] })
  s.addNotes('Instead of matching signatures, we fingerprint behaviour and compare it with what the package itself claims. So a brand-new attack is caught as long as it does something its README does not mention. We also run every package five ways to catch code that only misbehaves on build servers or on a certain date.')
}

// ── 4. How it works ─────────────────────────────────────────────────────────
{
  const s = pres.addSlide({ masterName: 'TL_CONTENT' })
  title(s, 'HOW IT WORKS.')
  const steps = [
    ['Get it', 'npm / PyPI name or upload. Download only, nothing runs'],
    ['Read README', 'What it promises: hosts, files, env vars, programs'],
    ['Sandbox ×5', 'Install, import, run examples. A hook logs everything'],
    ['Fingerprint', 'net · files · env vars · processes'],
    ['Compare', 'claimed · expected · unclaimed · contradicted'],
  ]
  const w = 1.62, gap = 0.22
  steps.forEach(([h, d], i) => {
    const x = 0.5 + i * (w + gap)
    card(s, x, 1.45, w, 1.75, i === 2 ? SOFT : CARD)
    circleNum(s, x + 0.15, 1.6, i + 1, 0.38)
    s.addText([{ text: h, options: { bold: true, fontSize: 13, color: INK, breakLine: true } },
      { text: d, options: { fontSize: 10.5, color: MUTED } }],
    { x: x + 0.15, y: 2.08, w: w - 0.3, h: 1.05, fontFace: BODY, margin: 0, valign: 'top', isTextBox: true })
    if (i < steps.length - 1) {
      s.addShape(pres.shapes.LINE, { x: x + w + 0.03, y: 2.32, w: gap - 0.06, h: 0, line: { color: ORANGE, width: 1.5, endArrowType: 'triangle' } })
    }
  })
  // The sandbox, in one line each.
  card(s, 0.5, 3.45, 9, 1.55)
  s.addText('The sandbox: a sealed room with a camera', { x: 0.7, y: 3.55, w: 8.6, h: 0.35, fontFace: HEAD, fontSize: 13, bold: true, color: ORANGE, margin: 0, isTextBox: true })
  const facts = [
    ['Fresh Docker container', 'per run, deleted after'],
    ['No internet', 'attempts are logged, never reach anyone'],
    ['None of your files', 'read-only, no admin, CPU/memory capped'],
    ['Hook inside Node / Python', 'records connections, files, env reads, programs'],
  ]
  facts.forEach(([h, d], i) => {
    s.addText([{ text: h, options: { bold: true, fontSize: 11.5, color: INK, breakLine: true } },
      { text: d, options: { fontSize: 10.5, color: MUTED } }],
    { x: 0.7 + i * 2.17, y: 4.0, w: 2.0, h: 0.85, fontFace: BODY, margin: 0, valign: 'top', isTextBox: true })
  })
  s.addText('Stack: Python + FastAPI · Docker · Node/Python runtime hooks · React UI', { x: 0.5, y: 5.15, w: 7.5, h: 0.25, fontFace: BODY, fontSize: 9.5, color: MUTED, margin: 0, isTextBox: true })
  s.addNotes('Five steps. We download the package and its dependencies without running anything. We read the README into a list of promises. Then we install and run it inside a sealed Docker sandbox with no internet, none of your files and no admin rights, while a small hook inside Node or Python logs every connection, file, environment variable and program. That log is the behavioural fingerprint, and we compare it line by line with the promises. All of this happens five times with different environments.')
}

// ── 5. Demo ─────────────────────────────────────────────────────────────────
{
  const s = pres.addSlide({ masterName: 'TL_CONTENT' })
  title(s, 'DEMO.')
  // The recorded 90 s demo, embedded; the poster frame is the video's title card.
  card(s, 0.44, 1.34, 5.12, 2.9325) // frame so the beige title card doesn't melt into the page
  const poster = require('fs').readFileSync(path.join(__dirname, 'video-poster.png')).toString('base64')
  s.addMedia({ type: 'video', path: path.join(__dirname, '..', 'TrustLens-demo.mp4'), x: 0.5, y: 1.4, w: 5.0, h: 2.8125,
    cover: 'data:image/png;base64,' + poster, objectName: 'demo video' })
  s.addText('Click to play the 90-second recorded run · live app at localhost:5173', { x: 0.5, y: 4.5, w: 5.0, h: 0.3, fontFace: BODY, fontSize: 10, color: MUTED, margin: 0, isTextBox: true })
  const cases = [
    ['pad-clean', 'fine', 'does nothing, as promised'],
    ['http-fetchy', 'suspicious', 'calls a server on import, never mentioned'],
    ['postinstall-probe', 'suspicious', 'runs a program during install'],
    ['ci-sleeper', 'dangerous', 'calls home only in CI; README says “no network”'],
    ['py-titlecase', 'dangerous', 'Python; goes quiet in CI to hide'],
  ]
  cases.forEach(([n, v, why], i) => {
    const y = 1.4 + i * 0.66
    const col = v === 'fine' ? '3B7D4F' : v === 'suspicious' ? 'C2410C' : 'B42318'
    s.addText([{ text: n + '  ', options: { bold: true, color: INK } }, { text: v, options: { bold: true, color: col } }],
      { x: 5.8, y, w: 3.7, h: 0.28, fontFace: BODY, fontSize: 12, margin: 0, isTextBox: true })
    s.addText(why, { x: 5.8, y: y + 0.27, w: 3.7, h: 0.3, fontFace: BODY, fontSize: 10.5, color: MUTED, margin: 0, isTextBox: true })
  })
  s.addNotes('Play the 90-second video or click through the live app. Our test cases are harmless packages built to behave like real attacks. Highlight ci-sleeper: it looks clean in a normal run, but only when it thinks it is on a CI server does it call home, and its README says no network access. Organiser test cases can be uploaded as a .zip/.tgz/.whl or typed as npm:name@version.')
}

// ── 6. Results and limitations ──────────────────────────────────────────────
{
  const s = pres.addSlide({ masterName: 'TL_CONTENT' })
  title(s, 'RESULTS & LIMITS.')
  const stats = [
    ['5 / 5', 'attack-style test packages flagged, incl. CI-only and evasion'],
    ['0', 'false alarms on 9 real packages (express, axios, requests, dotenv…)'],
    ['~1 min', 'per full scan, 5 runs, even with 69 dependencies'],
  ]
  stats.forEach(([n, d], i) => {
    const x = 0.5 + i * 3.05
    card(s, x, 1.4, 2.85, 1.5)
    s.addText(n, { x: x + 0.2, y: 1.5, w: 2.45, h: 0.75, fontFace: HEAD, fontSize: 34, bold: true, color: ORANGE, margin: 0, isTextBox: true })
    s.addText(d, { x: x + 0.2, y: 2.25, w: 2.45, h: 0.6, fontFace: BODY, fontSize: 11, color: INK, margin: 0, valign: 'top', isTextBox: true })
  })
  s.addText('Honest gaps', { x: 0.5, y: 3.15, w: 4, h: 0.35, fontFace: HEAD, fontSize: 14, bold: true, color: INK, margin: 0, isTextBox: true })
  const gaps = [
    'Sees what happens inside Node/Python, not inside native binaries it starts',
    'No internet in the sandbox: we see where it tries to send data, not what',
    'Short runs (seconds) and README examples only, so rare code paths can hide',
    'README reading is rule-based, so unusual wording can be missed',
  ]
  s.addText(gaps.map((g, i) => ({ text: g, options: { bullet: true, breakLine: i < gaps.length - 1 } })),
    { x: 0.5, y: 3.55, w: 9, h: 1.5, fontFace: BODY, fontSize: 12, color: MUTED, margin: 0, paraSpaceAfter: 4, valign: 'top', isTextBox: true })
  s.addNotes('Every attack-style test package was flagged with the right reason, including one that only misbehaves in CI and one that hides in CI. Nine real popular packages came back clean or minor, so no false alarms. A scan takes about a minute. Limits: we only see inside Node and Python, we cannot see payload contents because there is no network, runs are short, and README reading is rule-based.')
}

// ── 7. Next steps ───────────────────────────────────────────────────────────
{
  const s = pres.addSlide({ masterName: 'TL_CONTENT' })
  cubes(s, 7.4, 2.9, 0.75)
  title(s, 'NEXT STEPS.')
  const next = [
    ['System-level tracing', 'strace / eBPF to see native binaries too'],
    ['Fake internet', 'a safe sink that shows what data a package tries to send'],
    ['Smarter README reading', 'an LLM pass for wording rules miss (never the verdict)'],
    ['Pre-install guard', 'GitHub Action / npm hook that scans before install'],
  ]
  next.forEach(([h, d], i) => {
    const y = 1.4 + i * 0.72
    circleNum(s, 0.5, y + 0.05, i + 1, 0.4)
    s.addText([{ text: h, options: { bold: true, fontSize: 14, color: INK, breakLine: true } }, { text: d, options: { fontSize: 11.5, color: MUTED } }],
      { x: 1.1, y, w: 5.6, h: 0.6, fontFace: BODY, margin: 0, valign: 'top', isTextBox: true })
  })
  card(s, 0.5, 4.4, 6.2, 0.6, SOFT)
  s.addText([{ text: 'GitHub: ', options: { bold: true, color: ORANGE } }, { text: '[github.com/your-team/trustlens]', options: { color: INK } }],
    { x: 0.7, y: 4.45, w: 5.9, h: 0.5, fontFace: BODY, fontSize: 13, margin: 0, valign: 'middle', isTextBox: true })
  s.addNotes('Next we would add system-level tracing for native code, a safe fake internet to see payloads, an LLM pass to read READMEs better, and a pre-install guard for CI. The code is on GitHub at [link]. Thank you, happy to take questions.')
}

pres.writeFile({ fileName: path.join(__dirname, 'TrustLens-deck.pptx') }).then((f) => console.log('wrote', f))
