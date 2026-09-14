import { describe, expect, it } from 'vitest'
import {
  MAX_SHIFT_BP,
  SAMPLE_DECISION,
  runSensitivityAnalysis,
  type Decision,
  type FragilityBand,
} from './index'

const expectSuccess = (result: ReturnType<typeof runSensitivityAnalysis>) => {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Expected sensitivity analysis to succeed.')
  return result.value
}

function decisionWithTieAt(
  distanceBp: number,
  direction: 'decrease' | 'increase' = 'decrease',
): Decision {
  const decreases = direction === 'decrease'
  return {
    schemaVersion: 1,
    title: `Tie after ${distanceBp} bp`,
    criteria: [
      {
        id: 'pivot',
        name: 'Pivot',
        weightBp: 5_000 + (decreases ? distanceBp : -distanceBp),
      },
      {
        id: 'counterweight',
        name: 'Counterweight',
        weightBp: 5_000 + (decreases ? -distanceBp : distanceBp),
      },
    ],
    options: decreases
      ? [
          { id: 'winner', name: 'Winner', scores: { pivot: 6, counterweight: 5 } },
          {
            id: 'challenger',
            name: 'Challenger',
            scores: { pivot: 5, counterweight: 6 },
          },
        ]
      : [
          { id: 'winner', name: 'Winner', scores: { pivot: 5, counterweight: 6 } },
          {
            id: 'challenger',
            name: 'Challenger',
            scores: { pivot: 6, counterweight: 5 },
          },
        ],
  }
}

describe('runSensitivityAnalysis', () => {
  it('finds the approved sample threshold exactly', () => {
    const value = expectSuccess(runSensitivityAnalysis(SAMPLE_DECISION))

    expect(value.status).toBe('flip_found')
    if (value.status !== 'flip_found') return
    expect(value.baselineTopOptionIds).toEqual(['civic'])
    expect(value.baselineWinnerId).toBe('civic')
    expect(value.testedMaxShiftBp).toBe(3_000)
    expect(value.fragilityBand).toBe('fragile')
    expect(value.primaryShift).toEqual({
      criterionId: 'balance',
      direction: 'decrease',
      fromWeightBp: 2_500,
      toWeightBp: 2_207,
      deltaBp: -293,
      thresholdKind: 'new_winner',
      resultingTopOptionIds: ['northstar'],
      primaryChallengerId: 'northstar',
      trialWeights: [
        { criterionId: 'compensation', weightBp: 3_637 },
        { criterionId: 'growth', weightBp: 2_598 },
        { criterionId: 'balance', weightBp: 2_207 },
        { criterionId: 'mission', weightBp: 1_558 },
      ],
    })
  })

  it('returns baseline_tie without searching for a winner', () => {
    const decision = decisionWithTieAt(0)
    const value = expectSuccess(runSensitivityAnalysis(decision))

    expect(value).toEqual({
      status: 'baseline_tie',
      baselineTopOptionIds: ['winner', 'challenger'],
      baselineWinnerId: null,
      testedMaxShiftBp: MAX_SHIFT_BP,
      fragilityBand: 'tied',
      primaryShift: null,
      nearestShifts: [],
    })
  })

  it('reports stability only after the complete bounded search', () => {
    const decision: Decision = {
      schemaVersion: 1,
      title: 'Dominant option',
      criteria: [
        { id: 'one', name: 'One', weightBp: 5_000 },
        { id: 'two', name: 'Two', weightBp: 5_000 },
      ],
      options: [
        { id: 'winner', name: 'Winner', scores: { one: 10, two: 10 } },
        { id: 'other', name: 'Other', scores: { one: 1, two: 1 } },
      ],
    }

    expect(expectSuccess(runSensitivityAnalysis(decision))).toEqual({
      status: 'stable_within_range',
      baselineTopOptionIds: ['winner'],
      baselineWinnerId: 'winner',
      testedMaxShiftBp: MAX_SHIFT_BP,
      fragilityBand: 'stable_within_range',
      primaryShift: null,
      nearestShifts: [],
    })
  })

  it.each<readonly [number, FragilityBand]>([
    [1, 'hair_trigger'],
    [200, 'hair_trigger'],
    [201, 'fragile'],
    [500, 'fragile'],
    [501, 'sensitive'],
    [1_000, 'sensitive'],
    [1_001, 'steady'],
    [2_000, 'steady'],
    [2_001, 'robust'],
    [3_000, 'robust'],
  ])('classifies a %i bp threshold as %s', (distanceBp, expectedBand) => {
    const value = expectSuccess(
      runSensitivityAnalysis(decisionWithTieAt(distanceBp)),
    )
    expect(value.fragilityBand).toBe(expectedBand)
    expect(value.primaryShift?.deltaBp).toBe(-distanceBp)
  })

  it('does not report a threshold just beyond the 3,000 bp search cap', () => {
    const value = expectSuccess(
      runSensitivityAnalysis(decisionWithTieAt(MAX_SHIFT_BP + 1)),
    )

    expect(value.status).toBe('stable_within_range')
    expect(value.primaryShift).toBeNull()
    expect(value.nearestShifts).toEqual([])
  })

  it('finds a flip caused by raising a weight', () => {
    const value = expectSuccess(
      runSensitivityAnalysis(decisionWithTieAt(375, 'increase')),
    )

    expect(value.status).toBe('flip_found')
    expect(value.primaryShift).toMatchObject({
      criterionId: 'pivot',
      direction: 'increase',
      deltaBp: 375,
      thresholdKind: 'tie',
    })
  })

  it('distinguishes an immediate overtake from an exact tie threshold', () => {
    const decision: Decision = {
      schemaVersion: 1,
      title: 'Non-integral crossing',
      criteria: [
        { id: 'pivot', name: 'Pivot', weightBp: 3_500 },
        { id: 'counterweight', name: 'Counterweight', weightBp: 6_500 },
      ],
      options: [
        { id: 'winner', name: 'Winner', scores: { pivot: 7, counterweight: 5 } },
        {
          id: 'challenger',
          name: 'Challenger',
          scores: { pivot: 5, counterweight: 6 },
        },
      ],
    }

    const value = expectSuccess(runSensitivityAnalysis(decision))
    expect(value.primaryShift).toMatchObject({
      criterionId: 'pivot',
      direction: 'decrease',
      deltaBp: -167,
      thresholdKind: 'new_winner',
      resultingTopOptionIds: ['challenger'],
    })
  })

  it('returns all co-minimum shifts in locked deterministic order', () => {
    const baseDecision = decisionWithTieAt(100)
    const decision: Decision = {
      ...baseDecision,
      options: [
        baseDecision.options[0]!,
        baseDecision.options[1]!,
        {
          id: 'second-challenger',
          name: 'Second challenger',
          scores: { pivot: 5, counterweight: 6 },
        },
      ],
    }
    const value = expectSuccess(runSensitivityAnalysis(decision))

    expect(value.status).toBe('flip_found')
    if (value.status !== 'flip_found') return
    expect(value.nearestShifts.map(({ criterionId, direction }) => ({
      criterionId,
      direction,
    }))).toEqual([
      { criterionId: 'pivot', direction: 'decrease' },
      { criterionId: 'counterweight', direction: 'increase' },
    ])
    expect(value.primaryShift.primaryChallengerId).toBe('challenger')
    expect(value.primaryShift.resultingTopOptionIds).toEqual([
      'winner',
      'challenger',
      'second-challenger',
    ])
  })

  it('returns decision validation errors without throwing or partial analysis', () => {
    const invalid = structuredClone(SAMPLE_DECISION) as unknown as {
      criteria: Array<{ weightBp: number }>
    }
    invalid.criteria[0]!.weightBp = Number.NaN
    const result = runSensitivityAnalysis(invalid as unknown as Decision)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        code: 'WEIGHT_NOT_INTEGER',
        path: 'criteria[0].weightBp',
      })
    }
  })

  it('finishes the maximum 8 × 5 stable search within a browser-safe budget', () => {
    const criteria = Array.from({ length: 8 }, (_, index) => ({
      id: `criterion-${index}`,
      name: `Criterion ${index}`,
      weightBp: 1_250,
    }))
    const decision: Decision = {
      schemaVersion: 1,
      title: 'Worst case bounded search',
      criteria,
      options: Array.from({ length: 5 }, (_, optionIndex) => ({
        id: `option-${optionIndex}`,
        name: `Option ${optionIndex}`,
        scores: Object.fromEntries(
          criteria.map(({ id }) => [id, 10 - optionIndex]),
        ),
      })),
    }

    const startedAt = performance.now()
    const value = expectSuccess(runSensitivityAnalysis(decision))
    const elapsedMs = performance.now() - startedAt

    expect(value.status).toBe('stable_within_range')
    expect(elapsedMs).toBeLessThan(5_000)
  })
})
