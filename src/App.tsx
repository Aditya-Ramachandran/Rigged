import { SAMPLE_DECISION, validateDecision } from './domain'

export default function App() {
  const sampleStatus = validateDecision(SAMPLE_DECISION)

  return (
    <main>
      <p className="eyebrow">Phase 1</p>
      <h1>Rigged?</h1>
      <p className="lede">
        The decision model is ready. The interactive experience comes next.
      </p>
      <p role="status" className="status">
        Sample decision:{' '}
        <strong>{sampleStatus.ok ? 'valid' : 'needs attention'}</strong>
      </p>
    </main>
  )
}
