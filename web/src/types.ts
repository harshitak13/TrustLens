export type Status = 'claimed' | 'expected' | 'unclaimed' | 'contradicted'
export type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical'

export interface Row { cap: string; stage: string; first_ts: number; count: number; status: Status; severity: Severity; reason: string }
export interface Claimed { cap: string; family: string; seen: boolean }
export interface Summary { key: string; package: string; version: string; verdict: Severity; category: string; flagged: number }
export interface Scan {
  package: string; version: string; sha256: string; sample?: boolean; variants: string[]
  diff: { verdict: Severity; category: string; claimed: Claimed[]; observed: Row[]; denials: string[] }
  claims: { evidence: { cap: string; why: string }[]; snippets: string[] }
  matrix: { variants: string[]; rows: ({ cap: string } & Record<string, boolean | string>)[]; findings: { variant: string; cap: string }[]; evasions?: { variant: string; cap: string }[] }
  events: { ts: number; stage: string; type: string; target: string }[]
}
