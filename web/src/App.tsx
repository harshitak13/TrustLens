import { useEffect, useState } from 'react'
import ScanPanel from './ScanPanel'
import type { Row, Scan, Severity, Status, Summary } from './types'

const SEV: Record<Severity, string> = {
  none: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  low: 'bg-stone-100 text-stone-700 ring-stone-200',
  medium: 'bg-amber-50 text-amber-800 ring-amber-200',
  high: 'bg-orange-100 text-orange-800 ring-orange-300',
  critical: 'bg-red-50 text-red-700 ring-red-200',
}
const SEV_WORD: Record<Severity, string> = { none: 'fine', low: 'minor', medium: 'worth a look', high: 'suspicious', critical: 'dangerous' }

const STATUS: Record<Status, { text: string; cls: string }> = {
  claimed: { text: 'in the README', cls: 'text-emerald-700' },
  expected: { text: 'normal for this kind of package', cls: 'text-muted' },
  unclaimed: { text: 'not mentioned anywhere', cls: 'text-brand-dark' },
  contradicted: { text: 'README says it doesn’t', cls: 'text-red-700' },
}

// One plain sentence per verdict, so the top of the page reads like a person wrote it.
function verdictLine(s: Scan) {
  const name = s.package
  const flagged = s.diff.observed.filter((r) => r.status === 'unclaimed' || r.status === 'contradicted').length
  switch (s.diff.verdict) {
    case 'none': return `${name} does what its README says, and nothing else we could see.`
    case 'low': return `${name} mostly matches its README. ${flagged} small thing${flagged === 1 ? '' : 's'} it doesn’t mention.`
    case 'medium': return `${name} does a few things its README doesn’t mention. Worth a look before you install it.`
    case 'high': return `${name} does something its README never mentions, at a point where it shouldn’t. Be careful.`
    case 'critical': return `${name} does something its README says it doesn’t, or behaves differently when it thinks no one is watching. Don’t install it.`
  }
}

// "net:example.test" -> "Connects to example.test", so rows read as sentences.
function describe(cap: string) {
  const [fam, ...rest] = cap.split(':')
  const v = rest.join(':')
  if (fam === 'net') return <>Connects to <b>{v}</b></>
  if (fam === 'listen') return <>Opens port <b>{v}</b> for incoming connections</>
  if (fam === 'env') return <>Reads the <b>{v}</b> environment variable</>
  if (fam === 'proc') {
    if (v.startsWith('install-script:')) return <>Runs an install script: <b>{v.slice(15)}</b></>
    return <>Starts the program <b>{v}</b></>
  }
  if (fam === 'file') {
    const [op, ...p] = rest
    const path = p.join(':')
    const verb = op === 'write' ? 'Writes' : op === 'list' ? 'Looks inside' : op === '*' ? 'Uses' : 'Reads'
    return <>{verb} <b>{path}</b></>
  }
  return <>{cap}</>
}

function Pill({ sev, children }: { sev: Severity; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${SEV[sev]}`}>{children}</span>
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
      <circle cx="14" cy="14" r="9" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <path d="M21 21l7 7" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M10 14.5l2.6 2.6L18 11.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

type Tab = 'diff' | 'triggers' | 'timeline' | 'claims'
const TAB_LABEL: Record<Tab, string> = { diff: 'Promised vs. actual', triggers: 'Hidden triggers', timeline: 'Timeline', claims: 'What we read' }

export default function App() {
  const [list, setList] = useState<Summary[]>([])
  // ?scan=<pkg@ver>&tab=<tab> opens a result directly (handy for demo links).
  const params = new URLSearchParams(location.search)
  const [key, setKey] = useState<string | null>(params.get('scan'))
  const [scan, setScan] = useState<Scan | null>(null)
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'diff')
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    fetch('/api/scans').then((r) => r.json()).then((l: Summary[]) => { setList(l); setKey((k) => k ?? l[0]?.key ?? null) })
      .catch(() => setError('Can’t reach the API. Start it with: python -m uvicorn api.main:app --port 8000'))
  }, [version])
  useEffect(() => {
    if (key) fetch(`/api/scan/${encodeURIComponent(key)}`).then((r) => r.json()).then(setScan)
  }, [key, version])

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-line bg-card px-5 py-6 md:sticky md:top-0 md:h-screen md:w-72 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0">
        <div className="mb-1 flex items-center gap-2 text-brand">
          <Logo />
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">TrustLens</h1>
        </div>
        <p className="mb-6 text-sm text-muted">Does a package do what it says it does?</p>

        <ScanPanel onDone={(k) => { setKey(k); setVersion((v) => v + 1) }} />
        {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <h2 className="mt-7 mb-2 text-xs font-semibold tracking-wide text-faint">Checked so far</h2>
        <ul className="space-y-0.5">
          {list.map((s) => (
            <li key={s.key}>
              <button onClick={() => setKey(s.key)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${key === s.key ? 'bg-brand-soft font-semibold text-ink' : 'text-ink/80 hover:bg-paper'}`}>
                <span className="truncate">{s.package}<span className="font-normal text-faint">@{s.version}</span></span>
                <Pill sev={s.verdict}>{SEV_WORD[s.verdict]}</Pill>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {scan && (
        <main className="min-w-0 flex-1 px-5 py-8 md:px-12 md:py-10">
          <div className="max-w-5xl">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              {scan.source === 'registry' && <span className="rounded-full border border-line bg-card px-2.5 py-0.5">from the {scan.ecosystem === 'python' ? 'PyPI' : 'npm'} registry</span>}
              {scan.source === 'upload' && <span className="rounded-full border border-line bg-card px-2.5 py-0.5">uploaded</span>}
              {scan.source === 'local' && <span className="rounded-full border border-line bg-card px-2.5 py-0.5">test package</span>}
              <span>looks like a {scan.diff.category.replace('-', ' ')} package</span>
            </div>
            <h2 className="font-display text-4xl font-bold tracking-tight">
              {scan.package}<span className="font-medium text-faint">@{scan.version}</span>
            </h2>
            <div className="mt-4 flex flex-wrap items-start gap-3">
              <Pill sev={scan.diff.verdict}>{SEV_WORD[scan.diff.verdict]}</Pill>
              <p className="max-w-2xl text-lg leading-snug text-ink/90">{verdictLine(scan)}</p>
            </div>

            <nav className="mt-8 mb-6 flex gap-6 overflow-x-auto border-b border-line">
              {(['diff', 'triggers', 'timeline', 'claims'] as Tab[]).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`-mb-px shrink-0 border-b-2 pb-2.5 text-sm font-medium ${tab === t ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
                  {TAB_LABEL[t]}
                </button>
              ))}
            </nav>

            {tab === 'diff' && <DiffView scan={scan} />}
            {tab === 'triggers' && <Triggers scan={scan} />}
            {tab === 'timeline' && <Timeline scan={scan} />}
            {tab === 'claims' && <Claims scan={scan} />}
          </div>
        </main>
      )}
    </div>
  )
}

function Callout({ tone, title, children }: { tone: 'red' | 'amber'; title: string; children: React.ReactNode }) {
  const cls = tone === 'red' ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'
  return (
    <div className={`mb-6 rounded-xl border-l-4 p-4 ${cls}`}>
      <p className="font-semibold">{title}</p>
      <ul className="mt-2 space-y-1 text-sm">{children}</ul>
    </div>
  )
}

function ObservedRow({ r }: { r: Row }) {
  const flagged = r.status === 'unclaimed' || r.status === 'contradicted'
  return (
    <li className={`rounded-xl border bg-card px-4 py-3 ${flagged && r.severity !== 'low' ? 'border-orange-200' : 'border-line'}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[15px]">{describe(r.cap)}</span>
        {r.severity !== 'none' && <Pill sev={r.severity}>{SEV_WORD[r.severity]}</Pill>}
      </div>
      <p className="mt-1 text-sm">
        <span className={STATUS[r.status].cls}>{STATUS[r.status].text}</span>
        <span className="text-faint"> · during {r.stage}</span>
        {r.status === 'unclaimed' && r.reason && <span className="text-muted"> · {r.reason}</span>}
      </p>
    </li>
  )
}

function DiffView({ scan }: { scan: Scan }) {
  const { claimed, observed, denials } = scan.diff
  const findings = scan.matrix?.findings ?? []
  const evasions = scan.matrix?.evasions ?? []
  // Worst first, so the thing you need to see is at the top.
  const order: Severity[] = ['critical', 'high', 'medium', 'low', 'none']
  const rows = [...observed].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
  return (
    <>
      {findings.length > 0 && (
        <Callout tone="red" title="It behaves differently when it thinks it’s somewhere else">
          {findings.map((f) => <li key={f.variant + f.cap}>{describe(f.cap)}, but only when {variantWords(f.variant)}.</li>)}
        </Callout>
      )}
      {evasions.length > 0 && (
        <Callout tone="amber" title="It goes quiet in some environments">
          {evasions.map((f) => <li key={f.variant + f.cap}>{describe(f.cap)} normally, but stops when {variantWords(f.variant)}.</li>)}
        </Callout>
      )}
      <div className="grid gap-8 lg:grid-cols-[2fr_3fr]">
        <section>
          <h3 className="mb-3 font-display text-lg font-semibold">What the README promises</h3>
          <ul className="space-y-1.5">
            {denials.map((d) => (
              <li key={d} className="rounded-xl border border-line bg-card px-4 py-2.5 text-[15px]">
                Never uses <b>{DENIAL[d] ?? d}</b>
              </li>
            ))}
            {claimed.map((c) => (
              <li key={c.cap} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-2.5 text-[15px]">
                <span className="min-w-0 truncate" title={c.cap}>{describe(c.cap)}</span>
                <span className={`shrink-0 text-xs ${c.seen ? 'text-emerald-700' : 'text-faint'}`}>{c.seen ? '✓ saw it' : 'didn’t come up'}</span>
              </li>
            ))}
            {!claimed.length && !denials.length && <li className="text-muted">The README doesn’t say what it touches.</li>}
          </ul>
        </section>
        <section>
          <h3 className="mb-3 font-display text-lg font-semibold">What it actually did</h3>
          <ul className="space-y-2">
            {rows.map((r) => <ObservedRow key={r.cap + r.stage} r={r} />)}
            {!rows.length && (
              <li className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-muted">
                Nothing. No network, no files, no environment variables, no other programs.
              </li>
            )}
          </ul>
        </section>
      </div>
    </>
  )
}

const DENIAL: Record<string, string> = { net: 'the network', file: 'files', env: 'environment variables', proc: 'other programs' }

function variantWords(v: string) {
  return ({ ci: 'it thinks it’s running in CI', later: 'the date is in the future', host: 'the computer has a different name', user: 'a different user runs it' } as Record<string, string>)[v] ?? v
}

function Triggers({ scan }: { scan: Scan }) {
  const { variants, rows, findings } = scan.matrix
  const evasions = scan.matrix.evasions ?? []
  const odd = new Set([...findings, ...evasions].map((f) => `${f.variant}|${f.cap}`))
  const head: Record<string, string> = { baseline: 'Normal', ci: 'In CI', later: 'Future date', host: 'Other host', user: 'Other user' }
  return (
    <div>
      <p className="mb-4 max-w-2xl text-muted">
        We ran it five times, changing one thing each time. Anything that only shows up, or only disappears,
        in one of these runs is highlighted.
      </p>
      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th className="px-4 py-2.5 font-medium">What it did</th>
              {variants.map((v) => <th key={v} className="px-3 py-2.5 text-center font-medium">{head[v] ?? v}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cap} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">{describe(r.cap)}</td>
                {variants.map((v) => (
                  <td key={v} className={`px-3 py-2.5 text-center ${odd.has(`${v}|${r.cap}`) ? 'bg-brand-soft font-bold text-brand-dark' : 'text-faint'}`}>
                    {r[v] ? '●' : '–'}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && <tr><td className="px-4 py-6 text-center text-muted" colSpan={variants.length + 1}>Nothing happened in any run.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Timeline({ scan }: { scan: Scan }) {
  if (!scan.events.length) return <p className="text-muted">Nothing to show: the package didn’t do anything we track.</p>
  return (
    <ol className="relative ml-2 space-y-3 border-l-2 border-line pl-5">
      {scan.events.map((e, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[27px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand" />
          <span className="font-mono text-xs text-faint">{e.ts.toFixed(2)}s · {e.stage}</span>
          <p className="truncate font-mono text-sm">{e.type} → {e.target}</p>
        </li>
      ))}
    </ol>
  )
}

function Claims({ scan }: { scan: Scan }) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 font-display text-lg font-semibold">What we picked up from the README</h3>
        {scan.claims.evidence.length ? (
          <ul className="space-y-1.5 text-sm">
            {scan.claims.evidence.map((e) => <li key={e.cap}>{describe(e.cap)} <span className="text-muted">— {e.why}</span></li>)}
          </ul>
        ) : <p className="text-muted">Nothing specific.</p>}
      </section>
      {scan.claims.snippets.length > 0 && (
        <section>
          <h3 className="mb-2 font-display text-lg font-semibold">Examples we ran</h3>
          <div className="space-y-3">
            {scan.claims.snippets.map((s, i) => <pre key={i} className="overflow-x-auto rounded-xl border border-line bg-card p-4 font-mono text-xs leading-relaxed">{s}</pre>)}
          </div>
        </section>
      )}
    </div>
  )
}
