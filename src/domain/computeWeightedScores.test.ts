import { describe, expect, it } from 'vitest'
import {
  SAMPLE_DECISION,
  computeWeightedScores,
  type Decision,
} from './index'

const expectSuccess = (result: ReturnType<typeof computeWeightedScores>) => {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Expected score computation to succeed.')
  return result.value
}

describe('computeWeightedScores', () => {
  it('computes the approved sample with exact units, order, and driver', () => {
    const value = expectSuccess(computeWeightedScores(SAMPLE_DECISION))

    expect(
      value.ranking.map(({ optionId, totalUnits, totalPoints, rank }) => ({
        optionId,
        totalUnits,
        totalPoints,
        rank,
      })),
    ).toEqual([
      { optionId: 'civic', totalUnits: 74_500, totalPoints: 7.45, rank: 1 },
      {
        optionId: 'northstar',
        totalUnits: 73_000,
        totalPoints: 7.3,
        rank: 2,
      },
      { optionId: 'atlas', totalUnits: 72_500, totalPoints: 7.25, rank: 3 },
    ])
    expect(value.topOptionIds).toEqual(['civic'])
    expect(value.winnerId).toBe('civic')
    expect(value.runnerUpOptionIds).toEqual(['northstar'])
    expect(value.marginUnits).toBe(1_500)
    expect(value.marginPoints).toBe(0.15)
    expect(value.driver).toEqual({
      criterionId: 'balance',
      winnerId: 'civic',
      runnerUpId: 'northstar',
      marginContributionUnits: 10_000,
      marginContributionPoints: 1,
    })
    expect(value.ranking[0]!.contributions).toEqual([
      {
        criterionId: 'compensation',
        score: 6,
        weightBp: 3_500,
        contributionUnits: 21_000,
        contributionPoints: 2.1,
      },
      {
        criterionId: 'growth',
        score: 7,
        weightBp: 2_500,
        contributionUnits: 17_500,
        contributionPoints: 1.75,
      },
      {
        criterionId: 'balance',
        score: 9,
        weightBp: 2_500,
        contributionUnits: 22_500,
        contributionPoints: 2.25,
      },
      {
        criterionId: 'mission',
        score: 9,
        weightBp: 1_500,
        contributionUnits: 13_500,
        contributionPoints: 1.35,
      },
    ])
  })

  it('preserves input order for exact ties and assigns competition ranks', () => {
    const decision: Decision = {
      schemaVersion: 1,
      title: 'Tie order',
      criteria: [
        { id: 'one', name: 'One', weightBp: 5_000 },
        { id: 'two', name: 'Two', weightBp: 5_000 },
      ],
      options: [
        { id: 'zulu', name: 'Zulu', scores: { one: 8, two: 8 } },
        { id: 'alpha', name: 'Alpha', scores: { one: 8, two: 8 } },
        { id: 'middle', name: 'Middle', scores: { one: 6, two: 6 } },
      ],
    }

    const value = expectSuccess(computeWeightedScores(decision))
    expect(value.ranking.map(({ optionId, rank }) => ({ optionId, rank }))).toEqual(
      [
        { optionId: 'zulu', rank: 1 },
        { optionId: 'alpha', rank: 1 },
        { optionId: 'middle', rank: 3 },
      ],
    )
    expect(value.topOptionIds).toEqual(['zulu', 'alpha'])
    expect(value.winnerId).toBeNull()
    expect(value.runnerUpOptionIds).toEqual([])
    expect(value.marginUnits).toBeNull()
    expect(value.marginPoints).toBeNull()
    expect(value.driver).toBeNull()
  })

  it('keeps all tied runners-up and uses the earliest one for the driver', () => {
    const decision: Decision = {
      schemaVersion: 1,
      title: 'Tied runners-up',
      criteria: [
        { id: 'first', name: 'First', weightBp: 5_000 },
        { id: 'second', name: 'Second', weightBp: 5_000 },
      ],
      options: [
        { id: 'winner', name: 'Winner', scores: { first: 10, second: 10 } },
        { id: 'zulu', name: 'Zulu', scores: { first: 7, second: 7 } },
        { id: 'alpha', name: 'Alpha', scores: { first: 8, second: 6 } },
      ],
    }

    const value = expectSuccess(computeWeightedScores(decision))
    expect(value.runnerUpOptionIds).toEqual(['zulu', 'alpha'])
    expect(value.driver).toMatchObject({
      criterionId: 'first',
      winnerId: 'winner',
      runnerUpId: 'zulu',
    })
  })

  it('breaks equal positive driver contributions by criterion order', () => {
    const decision: Decision = {
      schemaVersion: 1,
      title: 'Driver tie',
      criteria: [
        { id: 'earlier', name: 'Earlier', weightBp: 5_000 },
        { id: 'later', name: 'Later', weightBp: 5_000 },
      ],
      options: [
        { id: 'winner', name: 'Winner', scores: { earlier: 6, later: 6 } },
        { id: 'runner', name: 'Runner', scores: { earlier: 4, later: 4 } },
      ],
    }

    const value = expectSuccess(computeWeightedScores(decision))
    expect(value.driver).toEqual({
      criterionId: 'earlier',
      winnerId: 'winner',
      runnerUpId: 'runner',
      marginContributionUnits: 10_000,
      marginContributionPoints: 1,
    })
  })

  it('returns validation errors rather than a partial ranking', () => {
    const invalid = structuredClone(SAMPLE_DECISION) as unknown as {
      criteria: Array<{ weightBp: number }>
    }
    invalid.criteria[0]!.weightBp = 3_499

    const result = computeWeightedScores(invalid as unknown as Decision)
    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: 'WEIGHTS_MUST_TOTAL_100_PERCENT',
          path: 'criteria',
          message: 'Criterion weights must total exactly 10000 basis points.',
        },
      ],
    })
  })

  it('does not mutate a frozen decision', () => {
    const decision = structuredClone(SAMPLE_DECISION)
    decision.criteria.forEach(Object.freeze)
    decision.options.forEach((option) => {
      Object.freeze(option.scores)
      Object.freeze(option)
    })
    Object.freeze(decision.criteria)
    Object.freeze(decision.options)
    Object.freeze(decision)
    const before = JSON.stringify(decision)

    expect(() => computeWeightedScores(decision)).not.toThrow()
    expect(JSON.stringify(decision)).toBe(before)
  })
})
