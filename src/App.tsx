import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

const APPEARANCE_KEY = 'rigged:appearance:v1'

const criteria = [
  { name: 'Compensation', weight: '35%', className: 'compensation' },
  { name: 'Growth', weight: '25%', className: 'growth' },
  { name: 'Balance', weight: '25%', className: 'balance' },
  { name: 'Mission', weight: '15%', className: 'mission' },
]

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function initialAppearance(): { theme: Theme; hasManualPreference: boolean } {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? 'null')
    if (
      typeof saved === 'object' && saved !== null && 'schemaVersion' in saved && 'theme' in saved &&
      saved.schemaVersion === 1 && (saved.theme === 'light' || saved.theme === 'dark')
    ) return { theme: saved.theme, hasManualPreference: true }
  } catch {
    // Appearance is optional; blocked storage must not block the decision tool.
  }
  return { theme: systemTheme(), hasManualPreference: false }
}

function ThemeIcon({ theme }: { theme: Theme }) {
  return <span className="theme-icon" aria-hidden="true">
    <svg className="sun-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.8" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.28 5.28l1.41 1.41M17.31 17.31l1.41 1.41M18.72 5.28l-1.41 1.41M6.69 17.31l-1.41 1.41" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
    <svg className="moon-icon" viewBox="0 0 24 24" fill="none"><path d="M20.5 15.1A8.5 8.5 0 1 1 8.9 3.5 6.7 6.7 0 0 0 20.5 15.1Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
    <span>{theme === 'light' ? 'Light' : 'Dark'}</span>
  </span>
}

export default function App() {
  const [appearance] = useState(initialAppearance)
  const [theme, setTheme] = useState<Theme>(appearance.theme)
  const [hasManualPreference, setHasManualPreference] = useState(appearance.hasManualPreference)

  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => {
    if (hasManualPreference) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const syncSystemTheme = (event: MediaQueryListEvent) => setTheme(event.matches ? 'dark' : 'light')
    media.addEventListener('change', syncSystemTheme)
    return () => media.removeEventListener('change', syncSystemTheme)
  }, [hasManualPreference])

  const toggleTheme = () => {
    const nextTheme: Theme = theme === 'light' ? 'dark' : 'light'
    setTheme(nextTheme)
    setHasManualPreference(true)
    try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ schemaVersion: 1, theme: nextTheme })) } catch { /* session state remains usable */ }
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to the decision</a>
    <header className="site-header">
      <a className="wordmark" href="#main-content" aria-label="Rigged? home">Rigged<span>?</span></a>
      <p className="header-note">A decision matrix with receipts.</p>
      <button className="theme-toggle" type="button" aria-pressed={theme === 'dark'} aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} onClick={toggleTheme}><ThemeIcon theme={theme} /></button>
    </header>
    <main id="main-content">
      <section className="case-intro" aria-labelledby="page-title">
        <p className="kicker">Decision file / 01</p>
        <h1 id="page-title">Choose a job offer.</h1>
        <p className="intro-copy">Put your priorities under pressure. The answer should be able to explain itself.</p>
      </section>
      <section className="priority-sheet" aria-labelledby="priority-title">
        <div className="section-heading"><div><p className="kicker">Your priorities</p><h2 id="priority-title">Where the pressure sits</h2></div><p className="total" aria-label="Weights total 100 percent">100% total</p></div>
        <div className="pressure-rail" aria-label="Current priority weights">
          {criteria.map((criterion) => <div key={criterion.name} className={`rail-segment ${criterion.className}`}><span>{criterion.name}</span><strong>{criterion.weight}</strong></div>)}
        </div>
        <p className="sheet-note">Each priority has a voice. Later, you’ll be able to test how loudly it speaks.</p>
      </section>
      <section className="verdict-preview" aria-labelledby="verdict-title">
        <div className="verdict-index">Evidence-led, not spreadsheet-led.</div><p className="kicker">The verdict</p>
        <h2 id="verdict-title">A clear answer needs a clear audit trail.</h2>
        <p>Score your options, see the ranking, then find out which single priority is carrying the decision.</p>
      </section>
    </main>
    <footer className="site-footer">
      <div className="footer-rule" aria-hidden="true" />
      <p className="footer-story">Rigged? began with an uncomfortable question: are you choosing—or are your priorities choosing for you? It makes that hidden pressure visible, one honest decision at a time.</p>
      <div className="footer-meta"><a href="https://github.com/Aditya-Ramachandran/Rigged" target="_blank" rel="noopener noreferrer">View the Rigged? source on GitHub</a><p>Made with <span aria-label="love">❤️</span> by Aditya &amp; GPT-Sol</p></div>
    </footer>
  </div>
}
