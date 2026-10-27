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
    pending: 'bg-slate-700', running: 'bg-sky-400 animate-pulse', done: 'bg-emerald-400', failed: 'bg-red-400',
  }
  const ready = mode === 'fixture' ? !!path : mode === 'registry' ? !!spec.trim() : !!file
  const input = 'w-full rounded-md bg-slate-900 px-2 py-1.5 text-sm ring-1 ring-slate-700'
  return (
    <div className="mb-4 space-y-2">
      <div className="flex gap-1 text-xs">
        {(['fixture', 'registry', 'upload'] as Mode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)} disabled={busy}
            className={`flex-1 rounded px-2 py-1 capitalize ${mode === m ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-900'}`}>
            {m === 'registry' ? 'npm / PyPI' : m}
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
          placeholder="npm:axios@1.7.7 or pypi:requests==2.32.3" />
      )}
      {mode === 'upload' && (
        <button onClick={() => fileInput.current?.click()} disabled={busy}
          className={`${input} truncate text-left ${file ? '' : 'text-slate-500'}`}>
          {file ? file.name : 'Choose .tgz, .zip or .whl…'}
          <input ref={fileInput} type="file" accept=".tgz,.gz,.zip,.whl" className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </button>
      )}
      <button onClick={start} disabled={busy || !ready}
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
