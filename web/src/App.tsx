import { useEffect, useState } from 'react'
import type { Scan, Severity, Status, Summary } from './types'

const SEV: Record<Severity, string> = {
  none: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  low: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  medium: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  high: 'bg-orange-500/15 text-orange-300 ring-orange-500/30',
  critical: 'bg-red-500/20 text-red-300 ring-red-500/40',
}
const STATUS: Record<Status, string> = {
  claimed: 'text-emerald-300', expected: 'text-slate-400', unclaimed: 'text-orange-300', contradicted: 'text-red-300',
}
const VERDICT_LABEL: Record<Severity, string> = {
  none: 'Matches its README', low: 'Minor gaps', medium: 'Undocumented behaviour', high: 'Suspicious', critical: 'Dangerous',
}

function Pill({ sev, children }: { sev: Severity; children: React.ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${SEV[sev]}`}>{children}</span>
}

type Tab = 'diff' | 'triggers' | 'timeline' | 'claims'

export default function App() {
  const [list, setList] = useState<Summary[]>([])
  const [key, setKey] = useState<string | null>(null)
  const [scan, setScan] = useState<Scan | null>(null)
  const [tab, setTab] = useState<Tab>('diff')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/scans').then((r) => r.json()).then((l: Summary[]) => { setList(l); if (l.length) setKey(l[0].key) })
      .catch(() => setError('API not reachable. Start it with: uvicorn api.main:app --port 8000'))
  }, [])
  useEffect(() => {
    if (key) fetch(`/api/scan/${encodeURIComponent(key)}`).then((r) => r.json()).then(setScan)
  }, [key])

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-800 p-4 md:w-64 md:border-r md:border-b-0">
        <h1 className="mb-4 text-lg font-semibold tracking-tight">TrustLens</h1>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <ul className="space-y-1">
          {list.map((s) => (
            <li key={s.key}>
              <button onClick={() => setKey(s.key)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${key === s.key ? 'bg-slate-800' : 'hover:bg-slate-900'}`}>
                <span className="truncate">{s.key}</span><Pill sev={s.verdict}>{s.verdict}</Pill>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {scan && (
        <main className="flex-1 p-4 md:p-8">
          <header className="mb-6 flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold">{scan.package}<span className="text-slate-500">@{scan.version}</span></h2>
            <Pill sev={scan.diff.verdict}>{VERDICT_LABEL[scan.diff.verdict]}</Pill>
            <span className="text-sm text-slate-400">category: {scan.diff.category}</span>
            {scan.sample && <span className="text-xs text-amber-300">sample data</span>}
          </header>

          <nav className="mb-6 flex gap-1 border-b border-slate-800">
            {(['diff', 'triggers', 'timeline', 'claims'] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm capitalize ${tab === t ? 'border-sky-400 text-slate-100' : 'border-transparent text-slate-400'}`}>
                {t === 'triggers' ? 'Hidden triggers' : t}
              </button>
            ))}
          </nav>

          {tab === 'diff' && <DiffView scan={scan} />}
          {tab === 'triggers' && <Triggers scan={scan} />}
          {tab === 'timeline' && <Timeline scan={scan} />}
          {tab === 'claims' && <Claims scan={scan} />}
        </main>
      )}
    </div>
  )
}

function DiffView({ scan }: { scan: Scan }) {
  const { claimed, observed, denials } = scan.diff
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section>
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-400">README says</h3>
        <ul className="space-y-1.5">
          {claimed.map((c) => (
            <li key={c.cap} className="flex items-center justify-between rounded-md bg-slate-900 px-3 py-2 font-mono text-sm">
              {c.cap}<span className="text-xs text-slate-500">{c.seen ? 'seen' : 'not seen'}</span>
            </li>
          ))}
          {denials.map((d) => (
            <li key={d} className="rounded-md bg-slate-900 px-3 py-2 text-sm text-slate-300">Says it never uses <b>{d}</b></li>
          ))}
          {!claimed.length && !denials.length && <li className="text-sm text-slate-500">No behaviour claimed.</li>}
        </ul>
      </section>
      <section>
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-400">Package actually did</h3>
        <ul className="space-y-1.5">
          {observed.map((r) => (
            <li key={r.cap + r.stage} className="rounded-md bg-slate-900 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm">{r.cap}</span>
                <span className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500">{r.stage}</span>
                  <span className={STATUS[r.status]}>{r.status}</span>
                  {r.severity !== 'none' && <Pill sev={r.severity}>{r.severity}</Pill>}
                </span>
              </div>
              {r.reason && <p className="mt-1 text-xs text-slate-400">{r.reason}</p>}
            </li>
          ))}
          {!observed.length && <li className="text-sm text-slate-500">Nothing observed.</li>}
        </ul>
      </section>
    </div>
  )
}

function Triggers({ scan }: { scan: Scan }) {
  const { variants, rows, findings } = scan.matrix
  const found = new Set(findings.map((f) => `${f.variant}|${f.cap}`))
  return (
    <div className="overflow-x-auto">
      <p className="mb-3 text-sm text-slate-400">
        {findings.length ? `${findings.length} behaviour(s) only appear under a changed environment.` : 'Behaviour is the same in every environment.'}
      </p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-400"><th className="py-2 pr-4 font-medium">capability</th>
          {variants.map((v) => <th key={v} className="px-3 py-2 font-medium">{v}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cap} className="border-t border-slate-800">
              <td className="py-2 pr-4 font-mono">{r.cap}</td>
              {variants.map((v) => (
                <td key={v} className={`px-3 py-2 ${found.has(`${v}|${r.cap}`) ? 'text-red-300' : 'text-slate-400'}`}>{r[v] ? '●' : '·'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Timeline({ scan }: { scan: Scan }) {
  return (
    <ol className="space-y-1 font-mono text-sm">
      {scan.events.map((e, i) => (
        <li key={i} className="flex gap-3">
          <span className="w-16 text-right text-slate-500">{e.ts.toFixed(2)}s</span>
          <span className="w-16 text-slate-400">{e.stage}</span>
          <span className="w-10 text-sky-300">{e.type}</span>
          <span className="truncate">{e.target}</span>
        </li>
      ))}
    </ol>
  )
}

function Claims({ scan }: { scan: Scan }) {
  return (
    <div className="space-y-6">
      <ul className="space-y-1 text-sm">
        {scan.claims.evidence.map((e) => <li key={e.cap}><span className="font-mono">{e.cap}</span> <span className="text-slate-400">· {e.why}</span></li>)}
      </ul>
      {scan.claims.snippets.map((s, i) => <pre key={i} className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs">{s}</pre>)}
    </div>
  )
}
