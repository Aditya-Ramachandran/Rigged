import { useEffect, useMemo, useRef, useState } from 'react'
import { SAMPLE_DECISION, computeWeightedScores, generateExplanation, rebalanceWeights, runSensitivityAnalysis, validateDecision, type CriterionId, type Decision } from './domain'

type Theme = 'light' | 'dark'
const APPEARANCE_KEY = 'rigged:appearance:v1'
const DECISION_KEY = 'rigged:decision:v1'
const cloneSample = (): Decision => structuredClone(SAMPLE_DECISION)
const weight = (bp: number) => `${(bp / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}%`

function systemTheme(): Theme { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' }
function initialAppearance(): { theme: Theme; manual: boolean } { try { const saved: unknown = JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? 'null'); if (typeof saved === 'object' && saved !== null && 'theme' in saved && (saved.theme === 'light' || saved.theme === 'dark')) return { theme: saved.theme, manual: true } } catch { /* use system */ } return { theme: systemTheme(), manual: false } }
function ThemeIcon({ dark }: { dark: boolean }) { return <span className="theme-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d={dark ? 'M20 15A8 8 0 1 1 9 4a6 6 0 0 0 11 11Z' : 'M12 3v2m0 14v2m9-9h-2M5 12H3m15.4-6.4-1.4 1.4M7 17l-1.4 1.4m0-12.8L7 7m10 10 1.4 1.4'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" /></svg><span>{dark ? 'Dark' : 'Light'}</span></span> }
function uniqueId(): string { return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `criterion-${Date.now()}-${Math.random().toString(36).slice(2)}` }
function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> { return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key)) }
const codePointLength = (value: string) => Array.from(value).length
const hasControl = (value: string) => Array.from(value).some((character) => { const point = character.codePointAt(0) ?? 0; return point <= 8 || point === 11 || point === 12 || (point >= 14 && point <= 31) || (point >= 127 && point <= 159) })
function initialDecision(): { decision: Decision; status: 'idle' | 'recovered-invalid' | 'unavailable' } { try { const raw = localStorage.getItem(DECISION_KEY); if (raw === null) return { decision: cloneSample(), status: 'idle' }; const saved: unknown = JSON.parse(raw); if (typeof saved === 'object' && saved !== null && 'schemaVersion' in saved && 'decision' in saved && saved.schemaVersion === 1) { const checked = validateDecision(saved.decision); if (checked.ok) return { decision: checked.value, status: 'idle' } } return { decision: cloneSample(), status: 'recovered-invalid' } } catch { return { decision: cloneSample(), status: 'unavailable' } } }

export default function App() {
  const [appearance] = useState(initialAppearance)
  const [theme, setTheme] = useState<Theme>(appearance.theme)
  const [manualTheme, setManualTheme] = useState(appearance.manual)
  const [stored] = useState(initialDecision)
  const [decision, setDecision] = useState<Decision>(stored.decision)
  const [persistence, setPersistence] = useState<'idle' | 'saved' | 'recovered-invalid' | 'unavailable'>(stored.status)
  const [showNotice, setShowNotice] = useState(stored.status !== 'idle')
  const [drafts, setDrafts] = useState<Record<CriterionId, string>>({})
  const [errors, setErrors] = useState<Record<CriterionId, string>>({})
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>({})
  const [optionErrors, setOptionErrors] = useState<Record<string, string>>({})
  const [announcement, setAnnouncement] = useState('')
  const names = useRef(new Map<CriterionId, HTMLInputElement>())
  const firstPersistenceRun = useRef(true)

  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => { if (manualTheme) return; const media = window.matchMedia('(prefers-color-scheme: dark)'); const update = (event: MediaQueryListEvent) => setTheme(event.matches ? 'dark' : 'light'); media.addEventListener('change', update); return () => media.removeEventListener('change', update) }, [manualTheme])
  useEffect(() => {
    if (firstPersistenceRun.current) { firstPersistenceRun.current = false; return }
    const checked = validateDecision(decision)
    if (!checked.ok) return
    const save = () => { try { localStorage.setItem(DECISION_KEY, JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), decision: checked.value })); setPersistence('saved') } catch { setPersistence('unavailable') } }
    const timeout = window.setTimeout(save, 250)
    const flush = () => { if (document.visibilityState === 'hidden') { window.clearTimeout(timeout); save() } }
    document.addEventListener('visibilitychange', flush)
    return () => { window.clearTimeout(timeout); document.removeEventListener('visibilitychange', flush) }
  }, [decision])
  const toggleTheme = () => { const next = theme === 'light' ? 'dark' : 'light'; setTheme(next); setManualTheme(true); try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ schemaVersion: 1, theme: next })) } catch { /* in-memory selection still works */ } }
  const resetDecision = () => { if (JSON.stringify(decision) !== JSON.stringify(SAMPLE_DECISION) && !window.confirm('Reset this decision to the job-offer sample?')) return; setDecision(cloneSample()); setDrafts({}); setErrors({}) }
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
  const commitOptionName = (id: string) => { const candidate = (optionDrafts[id] ?? decision.options.find((option) => option.id === id)?.name ?? '').trim(); const duplicate = decision.options.some((option) => option.id !== id && option.name.trim().normalize('NFKC').toLowerCase() === candidate.normalize('NFKC').toLowerCase()); if (!candidate || codePointLength(candidate) > 60 || duplicate || hasControl(candidate)) { setOptionErrors((current) => ({ ...current, [id]: !candidate ? 'An option needs a name.' : duplicate ? 'That option name is already in use.' : hasControl(candidate) ? 'Names cannot contain control characters.' : 'Use 60 characters or fewer.' })); return } setDecision((current) => ({ ...current, options: current.options.map((option) => option.id === id ? { ...option, name: candidate } : option) })); setOptionDrafts((current) => withoutKey(current, id)); setOptionErrors((current) => withoutKey(current, id)) }
  const setScore = (optionId: string, criterionId: string, score: number) => setDecision((current) => ({ ...current, options: current.options.map((option) => option.id === optionId ? { ...option, scores: { ...option.scores, [criterionId]: score } } : option) }))
  const addOption = () => { if (decision.options.length >= 5) return; const id = uniqueId(); setDecision((current) => ({ ...current, options: [...current.options, { id, name: `Option ${current.options.length + 1}`, scores: Object.fromEntries(current.criteria.map((criterion) => [criterion.id, 5])) }] })) }
  const removeOption = (id: string) => { if (decision.options.length > 2) setDecision((current) => ({ ...current, options: current.options.filter((option) => option.id !== id) })) }
  const analysis = useMemo(() => {
    const scores = computeWeightedScores(decision); const sensitivity = runSensitivityAnalysis(decision)
    if (!scores.ok || !sensitivity.ok) return null
    const explanation = generateExplanation({ decision, scores: scores.value, sensitivity: sensitivity.value })
    return explanation.ok ? { scores: scores.value, sensitivity: sensitivity.value, explanation: explanation.value } : null
  }, [decision])
  useEffect(() => { if (!analysis) return; const timer = window.setTimeout(() => setAnnouncement(`${analysis.explanation.verdictHeadline} ${analysis.explanation.sensitivityStatement}`), 350); return () => window.clearTimeout(timer) }, [analysis])

  return <div className="app-shell"><p className="sr-only" aria-live="polite">{announcement}</p>
    <a className="skip-link" href="#main-content">Skip to priorities</a>
    <header className="site-header"><a className="wordmark" href="#main-content" aria-label="Rigged? home">Rigged<span>?</span></a><p className="header-note">A decision matrix with receipts.</p><div className="header-actions"><button className="reset-button" type="button" onClick={resetDecision}>Reset</button><button className="theme-toggle" type="button" aria-pressed={theme === 'dark'} aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} onClick={toggleTheme}><ThemeIcon dark={theme === 'dark'} /></button></div></header>
    <main id="main-content">{showNotice && persistence === 'recovered-invalid' && <div className="storage-notice" role="status">We couldn’t read your saved decision, so the sample was restored.<button type="button" onClick={() => setShowNotice(false)}>Dismiss</button></div>}{showNotice && persistence === 'unavailable' && <div className="storage-notice" role="status">Your changes are available for this visit, but this browser can’t save them locally.<button type="button" onClick={() => setShowNotice(false)}>Dismiss</button></div>}
      <section className="case-intro" aria-labelledby="page-title"><p className="kicker">Decision file / 01</p><h1 id="page-title">{decision.title}.</h1><p className="intro-copy">Put your priorities under pressure. The answer should be able to explain itself.</p></section>
      <section className="priority-sheet" aria-labelledby="priority-title">
        <div className="section-heading"><div><p className="kicker">Your priorities</p><h2 id="priority-title">Where the pressure sits</h2></div><p className="total" aria-live="polite">{weight(decision.criteria.reduce((sum, criterion) => sum + criterion.weightBp, 0))} total</p></div>
        <div className="pressure-rail" aria-label="Priority weight distribution">{decision.criteria.map((criterion) => <div key={criterion.id} className="rail-segment" style={{ flexGrow: criterion.weightBp }}><span>{criterion.name}</span><strong>{weight(criterion.weightBp)}</strong><input className="rail-divider" aria-label={`Adjust ${criterion.name} weight`} aria-valuetext={`${criterion.name}: ${weight(criterion.weightBp)}. Other priorities rebalance automatically.`} type="range" min="0" max="10000" step="100" value={criterion.weightBp} onChange={(event) => setWeight(criterion.id, Number(event.target.value))} /></div>)}</div>
        <fieldset className="priority-controls"><legend>Adjust your priorities</legend>{decision.criteria.map((criterion) => <div className="priority-control" key={criterion.id}><label htmlFor={`name-${criterion.id}`}>Priority name</label><div className="control-row"><input id={`name-${criterion.id}`} ref={(element) => { if (element) names.current.set(criterion.id, element); else names.current.delete(criterion.id) }} value={drafts[criterion.id] ?? criterion.name} aria-invalid={Boolean(errors[criterion.id])} onChange={(event) => setDrafts((current) => ({ ...current, [criterion.id]: event.target.value }))} onBlur={() => commitName(criterion.id)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitName(criterion.id) } }} /><button type="button" onClick={() => removeCriterion(criterion.id)} disabled={decision.criteria.length <= 2}>Remove</button></div>{errors[criterion.id] && <p className="field-error" role="alert">{errors[criterion.id]}</p>}<label className="weight-control" htmlFor={`weight-${criterion.id}`}><span>{weight(criterion.weightBp)}</span><input id={`weight-${criterion.id}`} type="range" min="0" max="10000" step="100" value={criterion.weightBp} aria-valuetext={`${criterion.name}, ${weight(criterion.weightBp)}. Other priorities rebalance automatically.`} onChange={(event) => setWeight(criterion.id, Number(event.target.value))} /></label></div>)}</fieldset>
        <button className="add-priority" type="button" onClick={addCriterion} disabled={decision.criteria.length >= 8}>Add a priority <span aria-hidden="true">+</span></button>
        <p className="sheet-note">Every adjustment keeps the total at exactly 100%. The other priorities rebalance proportionally.</p>
      </section>
      <section className="options-sheet" aria-labelledby="options-title"><div className="section-heading"><div><p className="kicker">The options</p><h2 id="options-title">Score the evidence</h2></div><button className="add-priority" type="button" onClick={addOption} disabled={decision.options.length >= 5}>Add option +</button></div>{decision.options.map((option) => <article className="option-card" key={option.id}><div className="control-row"><label className="sr-only" htmlFor={`option-${option.id}`}>Option name</label><input id={`option-${option.id}`} value={optionDrafts[option.id] ?? option.name} aria-invalid={Boolean(optionErrors[option.id])} onChange={(event) => setOptionDrafts((current) => ({ ...current, [option.id]: event.target.value }))} onBlur={() => commitOptionName(option.id)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitOptionName(option.id) } }} /><button type="button" onClick={() => removeOption(option.id)} disabled={decision.options.length <= 2}>Remove</button></div>{optionErrors[option.id] && <p className="field-error" role="alert">{optionErrors[option.id]}</p>}<div className="score-grid">{decision.criteria.map((criterion) => <fieldset key={criterion.id}><legend>{criterion.name} <span>{weight(criterion.weightBp)}</span></legend><div className="score-strip" role="radiogroup" aria-label={`${option.name}, ${criterion.name} score`}>{Array.from({ length: 10 }, (_, index) => index + 1).map((score) => <label key={score}><input type="radio" name={`${option.id}-${criterion.id}`} value={score} checked={option.scores[criterion.id] === score} onChange={() => setScore(option.id, criterion.id, score)} /><span>{score}</span></label>)}</div></fieldset>)}</div></article>)}</section>
      {analysis && <section className="verdict-preview live-verdict" aria-labelledby="verdict-title"><div className="verdict-index">Live verdict / {analysis.explanation.fragilityLabel}</div><p className="kicker">The verdict</p><h2 id="verdict-title">{analysis.explanation.verdictHeadline}</h2><p>{analysis.explanation.verdictSummary}</p>{analysis.explanation.driverStatement && <><p className="verdict-driver">{analysis.explanation.driverStatement}</p><p className="verdict-detail">{analysis.explanation.driverDetail}</p></>}<p className="sensitivity"><strong>Stress test:</strong> {analysis.explanation.sensitivityStatement}</p><ol className="ranking">{analysis.scores.ranking.map((ranked) => <li key={ranked.optionId}><span>{ranked.rank}</span><strong>{decision.options.find((option) => option.id === ranked.optionId)?.name}</strong><em>{ranked.totalPoints.toFixed(2)}</em></li>)}</ol></section>}
    </main>
    <footer className="site-footer"><div className="footer-rule" aria-hidden="true" /><p className="footer-story">Rigged? began with an uncomfortable question: are you choosing—or are your priorities choosing for you? It makes that hidden pressure visible, one honest decision at a time.</p><div className="footer-meta"><a href="https://github.com/Aditya-Ramachandran/Rigged" target="_blank" rel="noopener noreferrer">View the Rigged? source on GitHub</a><p>Made with <span aria-label="love">❤️</span> by Aditya &amp; GPT-Sol</p></div></footer>
  </div>
}
