import { describe, expect, it } from 'vitest'
import {
  MAX_CRITERIA,
  SAMPLE_DECISION,
  TOTAL_WEIGHT_BP,
  rebalanceWeights,
  type Criterion,
  type RebalanceWeightsRequest,
} from './index'

const sampleCriteria = (): Criterion[] =>
  structuredClone(SAMPLE_DECISION.criteria) as unknown as Criterion[]

const run = (
  criteria: readonly Criterion[],
  criterionId: string,
  targetWeightBp: number,
) => rebalanceWeights({ criteria, criterionId, targetWeightBp })

const expectSuccess = (result: ReturnType<typeof rebalanceWeights>) => {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Expected rebalancing to succeed.')
  return result.value
}

const errorsFor = (input: unknown) => {
  const result = rebalanceWeights(input as RebalanceWeightsRequest)
  expect(result.ok).toBe(false)
  return result.ok ? [] : result.errors
}

describe('rebalanceWeights', () => {
  it('matches the approved sample Balance shift exactly', () => {
    const value = expectSuccess(run(sampleCriteria(), 'balance', 2_207))

    expect(value.criteria.map(({ weightBp }) => weightBp)).toEqual([
      3_637, 2_598, 2_207, 1_558,
    ])
    expect(value.changed).toEqual([
      {
        criterionId: 'compensation',
        fromWeightBp: 3_500,
        toWeightBp: 3_637,
      },
      { criterionId: 'growth', fromWeightBp: 2_500, toWeightBp: 2_598 },
      { criterionId: 'balance', fromWeightBp: 2_500, toWeightBp: 2_207 },
      { criterionId: 'mission', fromWeightBp: 1_500, toWeightBp: 1_558 },
    ])
  })

  it('returns fresh criteria and no changes for a no-op', () => {
    const criteria = sampleCriteria()
    const value = expectSuccess(run(criteria, 'growth', 2_500))

    expect(value.criteria).toEqual(criteria)
    expect(value.criteria).not.toBe(criteria)
    value.criteria.forEach((criterion, index) => {
      expect(criterion).not.toBe(criteria[index])
    })
    expect(value.changed).toEqual([])
  })

  it('supports target weights at both endpoints', () => {
    const zero = expectSuccess(run(sampleCriteria(), 'compensation', 0))
    expect(zero.criteria.map(({ weightBp }) => weightBp)).toEqual([
      0, 3_846, 3_846, 2_308,
    ])

    const full = expectSuccess(run(sampleCriteria(), 'compensation', 10_000))
    expect(full.criteria.map(({ weightBp }) => weightBp)).toEqual([
      10_000, 0, 0, 0,
    ])
  })

  it('splits evenly in original order when every other old weight is zero', () => {
    const criteria: Criterion[] = [
      { id: 'a', name: 'A', weightBp: 10_000 },
      { id: 'b', name: 'B', weightBp: 0 },
      { id: 'c', name: 'C', weightBp: 0 },
      { id: 'd', name: 'D', weightBp: 0 },
    ]

    const value = expectSuccess(run(criteria, 'a', 4_001))
    expect(value.criteria.map(({ weightBp }) => weightBp)).toEqual([
      4_001, 2_000, 2_000, 1_999,
    ])
  })

  it('breaks equal largest remainders by original criterion order', () => {
    const criteria: Criterion[] = [
      { id: 'target', name: 'Target', weightBp: 4_000 },
      { id: 'first', name: 'First', weightBp: 3_000 },
      { id: 'second', name: 'Second', weightBp: 3_000 },
    ]

    const value = expectSuccess(run(criteria, 'target', 5_001))
    expect(value.criteria.map(({ weightBp }) => weightBp)).toEqual([
      5_001, 2_500, 2_499,
    ])
  })

  it('preserves exact totals and valid integers through repeated edits', () => {
    let criteria = sampleCriteria()

    for (let iteration = 0; iteration < 250; iteration += 1) {
      const target = criteria[iteration % criteria.length]!
      const targetWeightBp = (iteration * 997) % (TOTAL_WEIGHT_BP + 1)
      criteria = [
        ...expectSuccess(run(criteria, target.id, targetWeightBp)).criteria,
      ]

      expect(criteria.reduce((sum, item) => sum + item.weightBp, 0)).toBe(
        TOTAL_WEIGHT_BP,
      )
      criteria.forEach(({ weightBp }) => {
        expect(Number.isInteger(weightBp)).toBe(true)
        expect(weightBp).toBeGreaterThanOrEqual(0)
        expect(weightBp).toBeLessThanOrEqual(TOTAL_WEIGHT_BP)
      })
    }
  })

  it('preserves criterion IDs, names, and order while ordering changes by input', () => {
    const criteria = sampleCriteria()
    const value = expectSuccess(run(criteria, 'compensation', 4_000))

    expect(value.criteria.map(({ id, name }) => ({ id, name }))).toEqual(
      criteria.map(({ id, name }) => ({ id, name })),
    )
    expect(value.changed.map(({ criterionId }) => criterionId)).toEqual(
      criteria.map(({ id }) => id),
    )
  })

  it('omits an unchanged zero-weight criterion from changed', () => {
    const criteria: Criterion[] = [
      { id: 'target', name: 'Target', weightBp: 4_000 },
      { id: 'zero', name: 'Zero stays zero', weightBp: 0 },
      { id: 'other', name: 'Other', weightBp: 6_000 },
    ]

    const value = expectSuccess(run(criteria, 'target', 5_000))
    expect(value.criteria.map(({ weightBp }) => weightBp)).toEqual([
      5_000, 0, 5_000,
    ])
    expect(value.changed).toEqual([
      {
        criterionId: 'target',
        fromWeightBp: 4_000,
        toWeightBp: 5_000,
      },
      {
        criterionId: 'other',
        fromWeightBp: 6_000,
        toWeightBp: 5_000,
      },
    ])
  })

  it('rejects invalid request and criteria shapes and count bounds', () => {
    expect(errorsFor(null)[0]).toMatchObject({
      code: 'INVALID_SHAPE',
      path: '',
    })
    expect(
      errorsFor({ criteria: new Date(), criterionId: 'a', targetWeightBp: 1 })[0],
    ).toMatchObject({ code: 'INVALID_SHAPE', path: 'criteria' })

    const one: Criterion[] = [{ id: 'a', name: 'A', weightBp: 10_000 }]
    expect(errorsFor({ criteria: one, criterionId: 'a', targetWeightBp: 5_000 })[0])
      .toMatchObject({ code: 'TOO_FEW_CRITERIA', path: 'criteria' })

    const tooMany = Array.from({ length: MAX_CRITERIA + 1 }, (_, index) => ({
      id: `c-${index}`,
      name: `Criterion ${index}`,
      weightBp: index === 0 ? 10_000 : 0,
    }))
    expect(
      errorsFor({
        criteria: tooMany,
        criterionId: 'c-0',
        targetWeightBp: 5_000,
      })[0],
    ).toMatchObject({ code: 'TOO_MANY_CRITERIA', path: 'criteria' })
  })

  it('rejects duplicate IDs and normalized duplicate names', () => {
    const criteria = sampleCriteria()
    criteria[1] = {
      ...criteria[1]!,
      id: criteria[0]!.id,
      name: ' ＣＯＭＰＥＮＳＡＴＩＯＮ ',
    }

    expect(
      errorsFor({
        criteria,
        criterionId: 'compensation',
        targetWeightBp: 4_000,
      }).map(({ code, path }) => ({ code, path })),
    ).toEqual([
      { code: 'DUPLICATE_ID', path: 'criteria[1].id' },
      { code: 'DUPLICATE_NAME', path: 'criteria[1].name' },
    ])
  })

  it('rejects invalid weights and totals before doing arithmetic', () => {
    for (const invalid of [2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const criteria = sampleCriteria()
      criteria[0] = { ...criteria[0]!, weightBp: invalid }
      expect(
        errorsFor({ criteria, criterionId: 'growth', targetWeightBp: 3_000 })[0],
      ).toMatchObject({
        code: 'WEIGHT_NOT_INTEGER',
        path: 'criteria[0].weightBp',
      })
    }

    const outOfRange = sampleCriteria()
    outOfRange[0] = { ...outOfRange[0]!, weightBp: -1 }
    expect(
      errorsFor({
        criteria: outOfRange,
        criterionId: 'growth',
        targetWeightBp: 3_000,
      })[0],
    ).toMatchObject({
      code: 'WEIGHT_OUT_OF_RANGE',
      path: 'criteria[0].weightBp',
    })

    const wrongTotal = sampleCriteria()
    wrongTotal[0] = { ...wrongTotal[0]!, weightBp: 3_499 }
    expect(
      errorsFor({
        criteria: wrongTotal,
        criterionId: 'growth',
        targetWeightBp: 3_000,
      })[0],
    ).toMatchObject({
      code: 'WEIGHTS_MUST_TOTAL_100_PERCENT',
      path: 'criteria',
    })
  })

  it('rejects a missing criterion and invalid target weights', () => {
    expect(
      errorsFor({
        criteria: sampleCriteria(),
        criterionId: '   ',
        targetWeightBp: 3_000,
      })[0],
    ).toMatchObject({ code: 'ID_REQUIRED', path: 'criterionId' })

    expect(
      errorsFor({
        criteria: sampleCriteria(),
        criterionId: 'missing',
        targetWeightBp: 3_000,
      })[0],
    ).toMatchObject({ code: 'CRITERION_NOT_FOUND', path: 'criterionId' })

    for (const invalid of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        errorsFor({
          criteria: sampleCriteria(),
          criterionId: 'growth',
          targetWeightBp: invalid,
        })[0],
      ).toMatchObject({
        code: 'TARGET_WEIGHT_NOT_INTEGER',
        path: 'targetWeightBp',
      })
    }

    for (const invalid of [-1, 10_001]) {
      expect(
        errorsFor({
          criteria: sampleCriteria(),
          criterionId: 'growth',
          targetWeightBp: invalid,
        })[0],
      ).toMatchObject({
        code: 'TARGET_WEIGHT_OUT_OF_RANGE',
        path: 'targetWeightBp',
      })
    }
  })

  it('never mutates the request or its criteria', () => {
    const criteria = sampleCriteria()
    criteria.forEach(Object.freeze)
    Object.freeze(criteria)
    const request = Object.freeze({
      criteria,
      criterionId: 'growth',
      targetWeightBp: 4_000,
    })
    const before = JSON.stringify(request)

    expect(() => rebalanceWeights(request)).not.toThrow()
    expect(JSON.stringify(request)).toBe(before)
  })
})
