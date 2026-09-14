import { useEffect, useRef, useState } from 'react'
import { SAMPLE_DECISION, rebalanceWeights, type CriterionId, type Decision } from './domain'

type Theme = 'light' | 'dark'
const APPEARANCE_KEY = 'rigged:appearance:v1'
const cloneSample = (): Decision => structuredClone(SAMPLE_DECISION)
const weight = (bp: number) => `${(bp / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}%`

function systemTheme(): Theme { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' }
function initialTheme(): Theme { try { const saved: unknown = JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? 'null'); if (typeof saved === 'object' && saved !== null && 'theme' in saved && (saved.theme === 'light' || saved.theme === 'dark')) return saved.theme } catch { /* use system */ } return systemTheme() }
function ThemeIcon({ dark }: { dark: boolean }) { return <span className="theme-icon" aria-hidden="true"><span>{dark ? '☾' : '☀'}</span><span>{dark ? 'Dark' : 'Light'}</span></span> }
function uniqueId(): string { return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `criterion-${Date.now()}-${Math.random().toString(36).slice(2)}` }
function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> { return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key)) }

export default function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [decision, setDecision] = useState<Decision>(cloneSample)
  const [drafts, setDrafts] = useState<Record<CriterionId, string>>({})
  const [errors, setErrors] = useState<Record<CriterionId, string>>({})
  const names = useRef(new Map<CriterionId, HTMLInputElement>())

  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  const toggleTheme = () => { const next = theme === 'light' ? 'dark' : 'light'; setTheme(next); try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ schemaVersion: 1, theme: next })) } catch { /* in-memory selection still works */ } }
  const setWeight = (criterionId: string, targetWeightBp: number) => {
    const next = rebalanceWeights({ criteria: decision.criteria, criterionId, targetWeightBp })
    if (next.ok) setDecision((current) => ({ ...current, criteria: [...next.value.criteria] }))
  }
  const commitName = (id: string) => {
    const candidate = (drafts[id] ?? decision.criteria.find((criterion) => criterion.id === id)?.name ?? '').trim()
    const duplicate = decision.criteria.some((criterion) => criterion.id !== id && criterion.name.trim().normalize('NFKC').toLowerCase() === candidate.normalize('NFKC').toLowerCase())
    if (!candidate) { setErrors((current) => ({ ...current, [id]: 'A priority needs a name.' })); return }
    if (candidate.length > 60) { setErrors((current) => ({ ...current, [id]: 'Use 60 characters or fewer.' })); return }
    if (duplicate) { setErrors((current) => ({ ...current, [id]: 'That priority name is already in use.' })); return }
    setDecision((current) => ({ ...current, criteria: current.criteria.map((criterion) => criterion.id === id ? { ...criterion, name: candidate } : criterion) }))
    setDrafts((current) => withoutKey(current, id))
    setErrors((current) => withoutKey(current, id))
  }
  const addCriterion = () => {
    if (decision.criteria.length >= 8) return
    const id = uniqueId(); let suffix = 1; let name = 'New priority'
    while (decision.criteria.some((criterion) => criterion.name === name)) { suffix += 1; name = `New priority ${suffix}` }
    const provisional = [...decision.criteria, { id, name, weightBp: 0 }]
    const rebalanced = rebalanceWeights({ criteria: provisional, criterionId: id, targetWeightBp: Math.round(10_000 / provisional.length) })
    if (!rebalanced.ok) return
    setDecision((current) => ({ ...current, criteria: [...rebalanced.value.criteria], options: current.options.map((option) => ({ ...option, scores: { ...option.scores, [id]: 5 } })) }))
    requestAnimationFrame(() => names.current.get(id)?.focus())
  }
  const removeCriterion = (id: string) => {
    if (decision.criteria.length <= 2) return
    const rebalanced = rebalanceWeights({ criteria: decision.criteria, criterionId: id, targetWeightBp: 0 })
    if (!rebalanced.ok) return
    setDecision((current) => ({ ...current, criteria: rebalanced.value.criteria.filter((criterion) => criterion.id !== id), options: current.options.map((option) => ({ ...option, scores: withoutKey(option.scores, id) })) }))
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to priorities</a>
    <header className="site-header"><a className="wordmark" href="#main-content" aria-label="Rigged? home">Rigged<span>?</span></a><p className="header-note">A decision matrix with receipts.</p><button className="theme-toggle" type="button" aria-pressed={theme === 'dark'} aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} onClick={toggleTheme}><ThemeIcon dark={theme === 'dark'} /></button></header>
    <main id="main-content">
      <section className="case-intro" aria-labelledby="page-title"><p className="kicker">Decision file / 01</p><h1 id="page-title">{decision.title}.</h1><p className="intro-copy">Put your priorities under pressure. The answer should be able to explain itself.</p></section>
      <section className="priority-sheet" aria-labelledby="priority-title">
        <div className="section-heading"><div><p className="kicker">Your priorities</p><h2 id="priority-title">Where the pressure sits</h2></div><p className="total" aria-live="polite">{weight(decision.criteria.reduce((sum, criterion) => sum + criterion.weightBp, 0))} total</p></div>
        <div className="pressure-rail" aria-label="Priority weight distribution">{decision.criteria.map((criterion) => <div key={criterion.id} className="rail-segment" style={{ flexGrow: criterion.weightBp }}><span>{criterion.name}</span><strong>{weight(criterion.weightBp)}</strong></div>)}</div>
        <fieldset className="priority-controls"><legend>Adjust your priorities</legend>{decision.criteria.map((criterion) => <div className="priority-control" key={criterion.id}><label htmlFor={`name-${criterion.id}`}>Priority name</label><div className="control-row"><input id={`name-${criterion.id}`} ref={(element) => { if (element) names.current.set(criterion.id, element); else names.current.delete(criterion.id) }} value={drafts[criterion.id] ?? criterion.name} aria-invalid={Boolean(errors[criterion.id])} onChange={(event) => setDrafts((current) => ({ ...current, [criterion.id]: event.target.value }))} onBlur={() => commitName(criterion.id)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitName(criterion.id) } }} /><button type="button" onClick={() => removeCriterion(criterion.id)} disabled={decision.criteria.length <= 2}>Remove</button></div>{errors[criterion.id] && <p className="field-error" role="alert">{errors[criterion.id]}</p>}<label className="weight-control" htmlFor={`weight-${criterion.id}`}><span>{weight(criterion.weightBp)}</span><input id={`weight-${criterion.id}`} type="range" min="0" max="10000" step="100" value={criterion.weightBp} aria-valuetext={`${criterion.name}, ${weight(criterion.weightBp)}. Other priorities rebalance automatically.`} onChange={(event) => setWeight(criterion.id, Number(event.target.value))} /></label></div>)}</fieldset>
        <button className="add-priority" type="button" onClick={addCriterion} disabled={decision.criteria.length >= 8}>Add a priority <span aria-hidden="true">+</span></button>
        <p className="sheet-note">Every adjustment keeps the total at exactly 100%. The other priorities rebalance proportionally.</p>
      </section>
      <section className="verdict-preview" aria-labelledby="verdict-title"><div className="verdict-index">Evidence-led, not spreadsheet-led.</div><p className="kicker">Next: score the options</p><h2 id="verdict-title">The verdict will show its working.</h2><p>In the next phase, you’ll score each offer and see which priority is actually carrying the decision.</p></section>
    </main>
    <footer className="site-footer"><div className="footer-rule" aria-hidden="true" /><p className="footer-story">Rigged? began with an uncomfortable question: are you choosing—or are your priorities choosing for you? It makes that hidden pressure visible, one honest decision at a time.</p><div className="footer-meta"><a href="https://github.com/Aditya-Ramachandran/Rigged" target="_blank" rel="noopener noreferrer">View the Rigged? source on GitHub</a><p>Made with <span aria-label="love">❤️</span> by Aditya &amp; GPT-Sol</p></div></footer>
  </div>
}
