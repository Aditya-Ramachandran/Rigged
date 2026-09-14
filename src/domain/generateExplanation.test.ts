import { describe, expect, it } from 'vitest'
import {
  SAMPLE_DECISION,
  computeWeightedScores,
  generateExplanation,
  runSensitivityAnalysis,
  type Decision,
  type GenerateExplanationRequest,
} from './index'

const analysesFor = (decision: Decision) => {
  const scoresResult = computeWeightedScores(decision)
  const sensitivityResult = runSensitivityAnalysis(decision)
  expect(scoresResult.ok).toBe(true)
  expect(sensitivityResult.ok).toBe(true)
  if (!scoresResult.ok || !sensitivityResult.ok) {
    throw new Error('Expected valid analyses.')
  }
  return { scores: scoresResult.value, sensitivity: sensitivityResult.value }
}

const explanationFor = (decision: Decision) => {
  const result = generateExplanation({ decision, ...analysesFor(decision) })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Expected an explanation.')
  return result.value
}

const dominantDecision = (): Decision => ({
  schemaVersion: 1,
  title: 'A stable result',
  criteria: [
    { id: 'one', name: 'One', weightBp: 5_000 },
    { id: 'two', name: 'Two', weightBp: 5_000 },
  ],
  options: [
    { id: 'winner', name: 'Winner', scores: { one: 10, two: 10 } },
    { id: 'runner', name: 'Runner', scores: { one: 1, two: 1 } },
  ],
})

describe('generateExplanation', () => {
  it('renders the approved sample with exact locked copy and formatting', () => {
    expect(explanationFor(SAMPLE_DECISION)).toEqual({
      verdictHeadline: 'Civic Studio wins.',
      verdictSummary:
        'Only 0.15 points separate it from Northstar Labs. That answer deserves a closer look.',
      driverStatement:
        'Balance is doing the heavy lifting for Civic Studio against Northstar Labs.',
      driverDetail:
        '25% weight × +4-point score gap = +1.00-point contribution to the lead.',
      sensitivityStatement:
        'Lower Balance from 25% to 22.07%, and Northstar Labs takes the lead.',
      fragilityLabel: 'Fragile',
      methodNote:
        'Sensitivity changes one priority at a time and rebalances the rest proportionally. It tests shifts up to 30 percentage points.',
    })
  })

  it('uses the non-close summary and bounded-stability wording', () => {
    const explanation = explanationFor(dominantDecision())

    expect(explanation.verdictSummary).toBe(
      'It leads Runner by 9.00 points after every priority is accounted for.',
    )
    expect(explanation.sensitivityStatement).toBe(
      'No single priority shift up to 30 percentage points dislodges Winner. The result is stable within the tested range.',
    )
    expect(explanation.fragilityLabel).toBe('Stable within ±30 pp')
  })

  it('explains an exact tie without inventing a winner or driver', () => {
    const decision: Decision = {
      schemaVersion: 1,
      title: 'Tied result',
      criteria: [
        { id: 'one', name: 'One', weightBp: 5_000 },
        { id: 'two', name: 'Two', weightBp: 5_000 },
      ],
      options: [
        { id: 'zulu', name: 'Zulu', scores: { one: 8, two: 6 } },
        { id: 'alpha', name: 'Alpha', scores: { one: 6, two: 8 } },
      ],
    }

    const explanation = explanationFor(decision)
    expect(explanation.verdictHeadline).toBe('No clear winner.')
    expect(explanation.verdictSummary).toBe(
      'Zulu and Alpha are level. Your current priorities do not produce a single winner.',
    )
    expect(explanation.driverStatement).toBeNull()
    expect(explanation.driverDetail).toBeNull()
    expect(explanation.fragilityLabel).toBe('No clear winner')
  })

  it('distinguishes a tie threshold in its sentence', () => {
    const decision: Decision = {
      schemaVersion: 1,
      title: 'Tie threshold',
      criteria: [
        { id: 'pivot', name: 'Pivot', weightBp: 5_100 },
        { id: 'other', name: 'Other', weightBp: 4_900 },
      ],
      options: [
        { id: 'winner', name: 'Winner', scores: { pivot: 6, other: 5 } },
        { id: 'runner', name: 'Runner', scores: { pivot: 5, other: 6 } },
      ],
    }

    expect(explanationFor(decision).sensitivityStatement).toBe(
      'Lower Pivot from 51% to 50%, and Runner draws level with Winner.',
    )
  })

  it('treats names as literal plain-text data', () => {
    const decision: Decision = {
      schemaVersion: 1,
      title: 'Literal names',
      criteria: [
        { id: 'one', name: '<script>One</script>', weightBp: 5_000 },
        { id: 'two', name: 'Two', weightBp: 5_000 },
      ],
      options: [
        { id: 'winner', name: '<b>Winner</b>', scores: { one: 10, two: 10 } },
        { id: 'runner', name: 'Runner & Co.', scores: { one: 1, two: 1 } },
      ],
    }

    const explanation = explanationFor(decision)
    expect(explanation.verdictHeadline).toBe('<b>Winner</b> wins.')
    expect(explanation.driverStatement).toContain('<script>One</script>')
    expect(explanation.verdictSummary).toContain('Runner & Co.')
  })

  it('rejects stale or foreign scores and sensitivity results', () => {
    const sampleAnalyses = analysesFor(SAMPLE_DECISION)
    const foreignAnalyses = analysesFor(dominantDecision())
    const staleScores = {
      ...sampleAnalyses.scores,
      winnerId: 'northstar',
    }

    const staleResult = generateExplanation({
      decision: SAMPLE_DECISION,
      scores: staleScores,
      sensitivity: sampleAnalyses.sensitivity,
    } as GenerateExplanationRequest)
    expect(staleResult).toEqual({
      ok: false,
      errors: [
        {
          code: 'ANALYSIS_MISMATCH',
          path: 'scores',
          message: 'The provided scores does not match this decision.',
        },
      ],
    })

    const foreignResult = generateExplanation({
      decision: SAMPLE_DECISION,
      scores: foreignAnalyses.scores,
      sensitivity: foreignAnalyses.sensitivity,
    } as GenerateExplanationRequest)
    expect(foreignResult.ok).toBe(false)
    if (!foreignResult.ok) {
      expect(foreignResult.errors.map(({ code, path }) => ({ code, path }))).toEqual(
        [
          { code: 'ANALYSIS_MISMATCH', path: 'scores' },
          { code: 'ANALYSIS_MISMATCH', path: 'sensitivity' },
        ],
      )
    }
  })

  it('propagates decision validation errors and never throws for bad shape', () => {
    const invalid = structuredClone(SAMPLE_DECISION) as unknown as {
      criteria: Array<{ weightBp: number }>
    }
    invalid.criteria[0]!.weightBp = 3_499
    const analyses = analysesFor(SAMPLE_DECISION)
    const result = generateExplanation({
      decision: invalid,
      ...analyses,
    } as unknown as GenerateExplanationRequest)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        code: 'WEIGHTS_MUST_TOTAL_100_PERCENT',
        path: 'criteria',
      })
    }
    expect(() =>
      generateExplanation(null as unknown as GenerateExplanationRequest),
    ).not.toThrow()
  })
})
