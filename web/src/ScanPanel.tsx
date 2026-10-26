import { useEffect, useState } from 'react'

const VARIANTS = ['baseline', 'ci', 'later', 'host', 'user']
// The Vite dev proxy buffers server-sent events, so the stream goes straight
// to the API (CORS is open there).
const API_DIRECT = import.meta.env.VITE_API_URL ?? `http://${location.hostname}:8000`
type StepState = 'pending' | 'running' | 'done' | 'failed'

// Starts a scan through the API and lights up one step per variant as the
// SSE stream reports progress. Calls onDone with the new scan key.
export default function ScanPanel({ onDone }: { onDone: (key: string) => void }) {
  const [fixtures, setFixtures] = useState<string[]>([])
  const [path, setPath] = useState('')
  const [steps, setSteps] = useState<Record<string, StepState>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/fixtures').then((r) => r.json()).then((f: string[]) => { setFixtures(f); setPath(f[0] ?? '') }).catch(() => {})
  }, [])

  async function start() {
    setBusy(true); setError('')
    setSteps(Object.fromEntries(VARIANTS.map((v) => [v, 'pending'])))
    const r = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })
    if (!r.ok) { setError((await r.json()).detail ?? 'scan failed'); setBusy(false); return }
    const { job } = await r.json()
    const es = new EventSource(`${API_DIRECT}/job/${job}/stream`)
    es.onmessage = (m) => {
      const e = JSON.parse(m.data)
      if (e.stage === 'error') { setError(e.error); setBusy(false); es.close(); return }
      if (e.stage === 'all') { setBusy(false); es.close(); onDone(e.key); return }
      setSteps((s) => ({ ...s, [e.stage]: e.state }))
    }
    es.onerror = () => { es.close(); setBusy(false) }
  }

  const dot: Record<StepState, string> = {
    pending: 'bg-slate-700', running: 'bg-sky-400 animate-pulse', done: 'bg-emerald-400', failed: 'bg-red-400',
  }
  return (
    <div className="mb-4 space-y-2">
      <select value={path} onChange={(e) => setPath(e.target.value)} disabled={busy}
        className="w-full rounded-md bg-slate-900 px-2 py-1.5 text-sm ring-1 ring-slate-700">
        {fixtures.map((f) => <option key={f}>{f}</option>)}
      </select>
      <button onClick={start} disabled={busy || !path}
        className="w-full rounded-md bg-sky-500 px-3 py-1.5 text-sm font-medium text-slate-950 disabled:opacity-50">
        {busy ? 'Scanning…' : 'Scan'}
      </button>
      {Object.keys(steps).length > 0 && (
        <ol className="space-y-1 text-xs text-slate-400">
          {VARIANTS.map((v) => (
            <li key={v} className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${dot[steps[v] ?? 'pending']}`} />{v}</li>
          ))}
        </ol>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  )
}
