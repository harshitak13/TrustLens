import { useEffect, useRef, useState } from 'react'

const VARIANTS = ['baseline', 'ci', 'later', 'host', 'user']
// The Vite dev proxy buffers server-sent events, so the stream goes straight
// to the API (CORS is open there).
const API_DIRECT = import.meta.env.VITE_API_URL ?? `http://${location.hostname}:8000`
type StepState = 'pending' | 'running' | 'done' | 'failed'
type Mode = 'fixture' | 'registry' | 'upload'

// Starts a scan (a fixture, a registry package, or an uploaded archive) and
// lights up one step per variant as the SSE stream reports progress.
export default function ScanPanel({ onDone }: { onDone: (key: string) => void }) {
  const [fixtures, setFixtures] = useState<string[]>([])
  const [mode, setMode] = useState<Mode>('fixture')
  const [path, setPath] = useState('')
  const [spec, setSpec] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [steps, setSteps] = useState<Record<string, StepState>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/fixtures').then((r) => r.json()).then((f: string[]) => { setFixtures(f); setPath(f[0] ?? '') }).catch(() => {})
  }, [])

  async function start() {
    setBusy(true); setError('')
    setSteps(Object.fromEntries(VARIANTS.map((v) => [v, 'pending'])))
    let r: Response
    if (mode === 'upload' && file) {
      const body = new FormData()
      body.append('file', file)
      r = await fetch('/api/upload', { method: 'POST', body })
    } else {
      r = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: mode === 'fixture' ? path : spec.trim() }) })
    }
    if (!r.ok) { setError((await r.json()).detail ?? 'scan failed'); setBusy(false); setSteps({}); return }
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
    pending: 'bg-line', running: 'bg-brand animate-pulse', done: 'bg-emerald-500', failed: 'bg-red-500',
  }
  const ready = mode === 'fixture' ? !!path : mode === 'registry' ? !!spec.trim() : !!file
  const input = 'w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none'
  return (
    <div className="space-y-2.5 rounded-2xl border border-line bg-paper/60 p-3">
      <div className="flex gap-1 rounded-lg bg-card p-1 text-xs ring-1 ring-line">
        {(['fixture', 'registry', 'upload'] as Mode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)} disabled={busy}
            className={`flex-1 whitespace-nowrap rounded-md px-2 py-1.5 font-medium ${mode === m ? 'bg-brand text-white' : 'text-muted hover:text-ink'}`}>
            {m === 'registry' ? 'npm/PyPI' : m === 'fixture' ? 'Examples' : 'Upload'}
          </button>
        ))}
      </div>
      {mode === 'fixture' && (
        <select value={path} onChange={(e) => setPath(e.target.value)} disabled={busy} className={input}>
          {fixtures.map((f) => <option key={f}>{f}</option>)}
        </select>
      )}
      {mode === 'registry' && (
        <input value={spec} onChange={(e) => setSpec(e.target.value)} disabled={busy} className={input}
          placeholder="npm:axios@1.7.7  or  pypi:requests==2.32.3" />
      )}
      {mode === 'upload' && (
        <button onClick={() => fileInput.current?.click()} disabled={busy}
          className={`${input} truncate text-left ${file ? '' : 'text-faint'}`}>
          {file ? file.name : 'Pick a .zip, .tgz or .whl file'}
          <input ref={fileInput} type="file" accept=".tgz,.gz,.zip,.whl" className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </button>
      )}
      <button onClick={start} disabled={busy || !ready}
        className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark disabled:opacity-40">
        {busy ? 'Checking… (about a minute)' : 'Check this package'}
      </button>
      {Object.keys(steps).length > 0 && (
        <ol className="grid grid-cols-2 gap-x-2 gap-y-1 px-1 text-xs text-muted">
          {VARIANTS.map((v) => (
            <li key={v} className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${dot[steps[v] ?? 'pending']}`} />{({ baseline: 'normal run', ci: 'pretend CI', later: 'future date', host: 'other host', user: 'other user' } as Record<string, string>)[v]}</li>
          ))}
        </ol>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  )
}
