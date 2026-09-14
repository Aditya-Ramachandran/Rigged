import { describe, expect, it } from 'vitest'
import {
  MAX_CRITERIA,
  MAX_OPTIONS,
  SAMPLE_DECISION,
  validateDecision,
} from './index'

type MutableDecision = {
  schemaVersion: unknown
  title: unknown
  criteria: Array<Record<string, unknown>>
  options: Array<Record<string, unknown>>
}

const decisionCopy = (): MutableDecision =>
  structuredClone(SAMPLE_DECISION) as unknown as MutableDecision

const errorsFor = (input: unknown) => {
  const result = validateDecision(input)
  expect(result.ok).toBe(false)
  return result.ok ? [] : result.errors
}

const codesFor = (input: unknown) =>
  errorsFor(input).map((error) => error.code)

const boundedDecision = (
  criterionCount: number,
  optionCount: number,
): MutableDecision => {
  const criteria = Array.from({ length: criterionCount }, (_, index) => ({
    id: `criterion-${index}`,
    name: `Criterion ${index}`,
    weightBp: index === 0 ? 10_000 : 0,
  }))

  return {
    schemaVersion: 1,
    title: 'A bounded decision',
    criteria,
    options: Array.from({ length: optionCount }, (_, index) => ({
      id: `option-${index}`,
      name: `Option ${index}`,
      scores: Object.fromEntries(criteria.map(({ id }) => [id, 5])),
    })),
  }
}

describe('validateDecision', () => {
  it('accepts the canonical fixture and returns a canonical copy', () => {
    const result = validateDecision(SAMPLE_DECISION)

    expect(result).toEqual({ ok: true, value: SAMPLE_DECISION })
    if (result.ok) expect(result.value).not.toBe(SAMPLE_DECISION)

    const padded = decisionCopy()
    padded.title = '  Choose a job offer  '
    padded.criteria[0]!.name = '  Compensation '
    padded.options[0]!.name = ' Northstar Labs  '
    const paddedResult = validateDecision(padded)
    expect(paddedResult.ok).toBe(true)
    if (paddedResult.ok) {
      expect(paddedResult.value.title).toBe('Choose a job offer')
      expect(paddedResult.value.criteria[0]!.name).toBe('Compensation')
      expect(paddedResult.value.options[0]!.name).toBe('Northstar Labs')
    }
  })

  it('requires a plain object at every object-shaped boundary', () => {
    for (const input of [null, [], new Date(), new Map(), 'decision']) {
      expect(errorsFor(input)).toEqual([
        {
          code: 'INVALID_SHAPE',
          path: '',
          message: 'Decision must be a plain object.',
        },
      ])
    }

    const nested = decisionCopy()
    nested.criteria[0] = new Date() as unknown as Record<string, unknown>
    nested.options[0]!.scores = new Map() as unknown as Record<string, unknown>
    const shapeErrors = errorsFor(nested)
      .filter(({ code }) => code === 'INVALID_SHAPE')
      .map(({ code, path }) => ({ code, path }))
    expect(shapeErrors).toEqual([
      { code: 'INVALID_SHAPE', path: 'criteria[0]' },
      { code: 'INVALID_SHAPE', path: 'options[0].scores' },
    ])
  })

  it('validates schema, required title, and array shape', () => {
    const decision = decisionCopy()
    decision.schemaVersion = 2
    decision.title = 42
    decision.criteria = null as unknown as Array<Record<string, unknown>>
    decision.options = 'offers' as unknown as Array<Record<string, unknown>>

    expect(errorsFor(decision).map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'UNSUPPORTED_SCHEMA_VERSION', path: 'schemaVersion' },
      { code: 'TITLE_REQUIRED', path: 'title' },
      { code: 'INVALID_SHAPE', path: 'criteria' },
      { code: 'INVALID_SHAPE', path: 'options' },
    ])
  })

  it('enforces the exact criteria and option count bounds', () => {
    expect(codesFor(boundedDecision(1, 1))).toEqual([
      'TOO_FEW_CRITERIA',
      'TOO_FEW_OPTIONS',
    ])
    expect(codesFor(boundedDecision(MAX_CRITERIA + 1, MAX_OPTIONS + 1))).toEqual([
      'TOO_MANY_CRITERIA',
      'TOO_MANY_OPTIONS',
    ])
    expect(validateDecision(boundedDecision(2, 2)).ok).toBe(true)
    expect(validateDecision(boundedDecision(MAX_CRITERIA, MAX_OPTIONS)).ok).toBe(
      true,
    )
  })

  it('measures title and names in Unicode code points', () => {
    const valid = decisionCopy()
    valid.title = '😀'.repeat(100)
    valid.criteria[0]!.name = '😀'.repeat(60)
    valid.options[0]!.name = '😀'.repeat(60)
    expect(validateDecision(valid).ok).toBe(true)

    const invalid = decisionCopy()
    invalid.title = '😀'.repeat(101)
    invalid.criteria[0]!.name = '😀'.repeat(61)
    invalid.options[0]!.name = '😀'.repeat(61)
    expect(errorsFor(invalid).map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'INVALID_SHAPE', path: 'title' },
      { code: 'NAME_TOO_LONG', path: 'criteria[0].name' },
      { code: 'NAME_TOO_LONG', path: 'options[0].name' },
    ])
  })

  it('detects duplicate names after trim, NFKC, and locale-independent case folding', () => {
    const decision = decisionCopy()
    decision.criteria[0]!.name = 'Focus'
    decision.criteria[1]!.name = '  ＦＯＣＵＳ  '
    decision.options[0]!.name = 'Civic'
    decision.options[1]!.name = ' ＣＩＶＩＣ '

    expect(errorsFor(decision).map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'DUPLICATE_NAME', path: 'criteria[1].name' },
      { code: 'DUPLICATE_NAME', path: 'options[1].name' },
    ])
  })

  it('requires bounded, nonempty IDs unique within each entity type', () => {
    const decision = decisionCopy()
    decision.criteria[0]!.id = ' '
    decision.criteria[1]!.id = 'x'.repeat(101)
    decision.criteria[2]!.id = 'mission'
    decision.criteria[3]!.id = 'mission'
    decision.options[0]!.id = ''
    decision.options[1]!.id = 'x'.repeat(101)
    decision.options[2]!.id = 'atlas'
    decision.options.push({
      ...structuredClone(decision.options[2]!),
      id: 'atlas',
      name: 'A fourth option',
    })

    const idErrors = errorsFor(decision)
      .filter(({ path }) => path.endsWith('.id'))
      .map(({ code, path }) => ({ code, path }))
    expect(idErrors).toEqual([
      { code: 'ID_REQUIRED', path: 'criteria[0].id' },
      { code: 'INVALID_SHAPE', path: 'criteria[1].id' },
      { code: 'DUPLICATE_ID', path: 'criteria[3].id' },
      { code: 'ID_REQUIRED', path: 'options[0].id' },
      { code: 'INVALID_SHAPE', path: 'options[1].id' },
      { code: 'DUPLICATE_ID', path: 'options[3].id' },
    ])
  })

  it('rejects control characters in user-visible strings', () => {
    const decision = decisionCopy()
    decision.title = 'Choose\u0000carefully'
    decision.criteria[0]!.name = 'Pay\u0007'
    decision.options[0]!.name = 'North\u007fstar'

    expect(errorsFor(decision).map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'INVALID_SHAPE', path: 'title' },
      { code: 'INVALID_SHAPE', path: 'criteria[0].name' },
      { code: 'INVALID_SHAPE', path: 'options[0].name' },
    ])
  })

  it('requires finite integer weights in range and an exact 10,000 bp sum', () => {
    for (const invalidWeight of [2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const decision = decisionCopy()
      decision.criteria[0]!.weightBp = invalidWeight
      expect(errorsFor(decision)[0]).toMatchObject({
        code: 'WEIGHT_NOT_INTEGER',
        path: 'criteria[0].weightBp',
      })
    }

    const outOfRange = decisionCopy()
    outOfRange.criteria[0]!.weightBp = -1
    outOfRange.criteria[1]!.weightBp = 10_001
    expect(codesFor(outOfRange)).toEqual([
      'WEIGHT_OUT_OF_RANGE',
      'WEIGHT_OUT_OF_RANGE',
    ])

    const wrongTotal = decisionCopy()
    wrongTotal.criteria[0]!.weightBp = 3_499
    expect(errorsFor(wrongTotal)[0]).toMatchObject({
      code: 'WEIGHTS_MUST_TOTAL_100_PERCENT',
      path: 'criteria',
    })
  })

  it('requires exactly one finite integer 1–10 score for each criterion', () => {
    const decision = decisionCopy()
    const scores = decision.options[0]!.scores as Record<string, unknown>
    delete scores.growth
    scores.compensation = Number.NaN
    scores.balance = 0
    scores.mission = 8.5
    scores.unknown = 7

    expect(errorsFor(decision).map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'SCORE_NOT_INTEGER', path: 'options[0].scores.compensation' },
      { code: 'SCORE_MISSING', path: 'options[0].scores.growth' },
      { code: 'SCORE_OUT_OF_RANGE', path: 'options[0].scores.balance' },
      { code: 'SCORE_NOT_INTEGER', path: 'options[0].scores.mission' },
      {
        code: 'UNKNOWN_SCORE_CRITERION',
        path: 'options[0].scores.unknown',
      },
    ])

    scores.compensation = Number.NEGATIVE_INFINITY
    expect(errorsFor(decision)[0]!.code).toBe('SCORE_NOT_INTEGER')
  })

  it('returns errors in a stable documented traversal order', () => {
    const decision = {
      schemaVersion: 3,
      title: ' ',
      criteria: [
        { id: 'same', name: 'Work', weightBp: 7_000 },
        { id: 'same', name: ' work ', weightBp: 3_500 },
      ],
      options: [
        { id: 'offer', name: 'One', scores: { same: 0, zebra: 4 } },
        { id: 'offer', name: ' one ', scores: {} },
      ],
    }

    const compactErrors = () =>
      errorsFor(decision).map(({ code, path }) => `${code}:${path}`)
    const expected = [
      'UNSUPPORTED_SCHEMA_VERSION:schemaVersion',
      'TITLE_REQUIRED:title',
      'DUPLICATE_ID:criteria[1].id',
      'DUPLICATE_NAME:criteria[1].name',
      'SCORE_OUT_OF_RANGE:options[0].scores.same',
      'UNKNOWN_SCORE_CRITERION:options[0].scores.zebra',
      'DUPLICATE_ID:options[1].id',
      'DUPLICATE_NAME:options[1].name',
      'SCORE_MISSING:options[1].scores.same',
      'WEIGHTS_MUST_TOTAL_100_PERCENT:criteria',
    ]

    expect(compactErrors()).toEqual(expected)
    expect(compactErrors()).toEqual(expected)
  })

  it('does not mutate input and converts hostile input into an error result', () => {
    const frozen = structuredClone(SAMPLE_DECISION)
    frozen.criteria.forEach(Object.freeze)
    frozen.options.forEach((option) => {
      Object.freeze(option.scores)
      Object.freeze(option)
    })
    Object.freeze(frozen.criteria)
    Object.freeze(frozen.options)
    Object.freeze(frozen)

    const before = JSON.stringify(frozen)
    expect(() => validateDecision(frozen)).not.toThrow()
    expect(JSON.stringify(frozen)).toBe(before)

    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('no inspection allowed')
        },
      },
    )
    expect(() => validateDecision(hostile)).not.toThrow()
    expect(errorsFor(hostile)[0]).toMatchObject({
      code: 'INVALID_SHAPE',
      path: '',
    })
  })
})
