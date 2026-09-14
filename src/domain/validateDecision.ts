import {
  MAX_CRITERIA,
  MAX_ID_CODE_POINTS,
  MAX_NAME_CODE_POINTS,
  MAX_OPTIONS,
  MAX_SCORE,
  MAX_TITLE_CODE_POINTS,
  MIN_CRITERIA,
  MIN_OPTIONS,
  MIN_SCORE,
  TOTAL_WEIGHT_BP,
} from './constants'
import type { DomainError, DomainErrorCode, DomainResult } from './result'
import {
  DECISION_SCHEMA_VERSION,
  type Criterion,
  type Decision,
  type DecisionOption,
} from './types'

type UnknownRecord = Record<string, unknown>

const hasForbiddenControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return (
      codePoint <= 0x08 ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    )
  })

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const codePointLength = (value: string): number => Array.from(value).length

// NFKC is used only for duplicate detection, never to rewrite user text.
const comparableName = (value: string): string =>
  value.trim().normalize('NFKC').toLowerCase()

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const makeError = (
  code: DomainErrorCode,
  path: string,
  message: string,
): DomainError => ({ code, path, message })

const failure = (errors: readonly DomainError[]): DomainResult<Decision> => ({
  ok: false,
  errors,
})

function validateTitle(value: unknown, errors: DomainError[]): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(
      makeError('TITLE_REQUIRED', 'title', 'Give this decision a title.'),
    )
    return false
  }

  if (
    codePointLength(value.trim()) > MAX_TITLE_CODE_POINTS ||
    hasForbiddenControlCharacter(value)
  ) {
    errors.push(
      makeError(
        'INVALID_SHAPE',
        'title',
        `Title must be at most ${MAX_TITLE_CODE_POINTS} characters and contain no control characters.`,
      ),
    )
    return false
  }

  return true
}

function validateId(
  value: unknown,
  path: string,
  label: string,
  errors: DomainError[],
): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(makeError('ID_REQUIRED', path, `${label} needs an ID.`))
    return false
  }

  if (codePointLength(value) > MAX_ID_CODE_POINTS) {
    errors.push(
      makeError(
        'INVALID_SHAPE',
        path,
        `${label} ID cannot exceed ${MAX_ID_CODE_POINTS} characters.`,
      ),
    )
    return false
  }

  return true
}

function validateName(
  value: unknown,
  path: string,
  label: string,
  errors: DomainError[],
): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(makeError('NAME_REQUIRED', path, `${label} needs a name.`))
    return false
  }

  if (codePointLength(value.trim()) > MAX_NAME_CODE_POINTS) {
    errors.push(
      makeError(
        'NAME_TOO_LONG',
        path,
        `${label} name cannot exceed ${MAX_NAME_CODE_POINTS} characters.`,
      ),
    )
    return false
  }

  if (hasForbiddenControlCharacter(value)) {
    errors.push(
      makeError(
        'INVALID_SHAPE',
        path,
        `${label} name cannot contain control characters.`,
      ),
    )
    return false
  }

  return true
}

function validateWeight(
  value: unknown,
  path: string,
  errors: DomainError[],
): value is number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value)
  ) {
    errors.push(
      makeError(
        'WEIGHT_NOT_INTEGER',
        path,
        'Weight must be a whole number of basis points.',
      ),
    )
    return false
  }

  if (value < 0 || value > TOTAL_WEIGHT_BP) {
    errors.push(
      makeError(
        'WEIGHT_OUT_OF_RANGE',
        path,
        `Weight must be between 0 and ${TOTAL_WEIGHT_BP} basis points.`,
      ),
    )
    return false
  }

  return true
}

function validateScore(
  value: unknown,
  path: string,
  errors: DomainError[],
): value is number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value)
  ) {
    errors.push(
      makeError('SCORE_NOT_INTEGER', path, 'Score must be a whole number.'),
    )
    return false
  }

  if (value < MIN_SCORE || value > MAX_SCORE) {
    errors.push(
      makeError(
        'SCORE_OUT_OF_RANGE',
        path,
        `Score must be between ${MIN_SCORE} and ${MAX_SCORE}.`,
      ),
    )
    return false
  }

  return true
}

/**
 * Validate and canonicalize unknown input without mutating it.
 *
 * Error order is deterministic: root fields, criteria in display order,
 * options in display order, then the cross-field weight total. Score keys
 * follow criterion order and unknown keys sort by code point.
 */
export function validateDecision(input: unknown): DomainResult<Decision> {
  try {
    if (!isPlainRecord(input)) {
      return failure([
        makeError('INVALID_SHAPE', '', 'Decision must be a plain object.'),
      ])
    }

    const errors: DomainError[] = []
    const validCriteria: Criterion[] = []
    const validOptions: DecisionOption[] = []

    if (input.schemaVersion !== DECISION_SCHEMA_VERSION) {
      errors.push(
        makeError(
          'UNSUPPORTED_SCHEMA_VERSION',
          'schemaVersion',
          `schemaVersion must be ${DECISION_SCHEMA_VERSION}.`,
        ),
      )
    }
    const title = input.title
    const titleIsValid = validateTitle(title, errors)

    const criterionIds: string[] = []
    let allWeightsValid = true
    let weightTotal = 0

    if (!Array.isArray(input.criteria)) {
      errors.push(
        makeError('INVALID_SHAPE', 'criteria', 'Criteria must be an array.'),
      )
      allWeightsValid = false
    } else {
      if (input.criteria.length < MIN_CRITERIA) {
        errors.push(
          makeError(
            'TOO_FEW_CRITERIA',
            'criteria',
            `Add at least ${MIN_CRITERIA} criteria.`,
          ),
        )
      } else if (input.criteria.length > MAX_CRITERIA) {
        errors.push(
          makeError(
            'TOO_MANY_CRITERIA',
            'criteria',
            `Use no more than ${MAX_CRITERIA} criteria.`,
          ),
        )
      }

      const seenIds = new Set<string>()
      const seenNames = new Set<string>()

      input.criteria.forEach((candidate, index) => {
        const path = `criteria[${index}]`
        if (!isPlainRecord(candidate)) {
          errors.push(
            makeError(
              'INVALID_SHAPE',
              path,
              'Each criterion must be a plain object.',
            ),
          )
          allWeightsValid = false
          return
        }

        const id = candidate.id
        const name = candidate.name
        const weightBp = candidate.weightBp

        const idIsValid = validateId(
          id,
          `${path}.id`,
          'Criterion',
          errors,
        )
        if (idIsValid) {
          criterionIds.push(id)
          if (seenIds.has(id)) {
            errors.push(
              makeError(
                'DUPLICATE_ID',
                `${path}.id`,
                `Criterion ID “${id}” is already in use.`,
              ),
            )
          } else {
            seenIds.add(id)
          }
        }

        const nameIsValid = validateName(
          name,
          `${path}.name`,
          'Criterion',
          errors,
        )
        if (nameIsValid) {
          const nameKey = comparableName(name)
          if (seenNames.has(nameKey)) {
            errors.push(
              makeError(
                'DUPLICATE_NAME',
                `${path}.name`,
                `Criterion name “${name.trim()}” is already in use.`,
              ),
            )
          } else {
            seenNames.add(nameKey)
          }
        }

        const weightIsValid = validateWeight(
          weightBp,
          `${path}.weightBp`,
          errors,
        )
        if (weightIsValid) {
          weightTotal += weightBp
        } else {
          allWeightsValid = false
        }

        if (idIsValid && nameIsValid && weightIsValid) {
          validCriteria.push({
            id,
            name: name.trim(),
            weightBp,
          })
        }
      })
    }

    if (!Array.isArray(input.options)) {
      errors.push(
        makeError('INVALID_SHAPE', 'options', 'Options must be an array.'),
      )
    } else {
      if (input.options.length < MIN_OPTIONS) {
        errors.push(
          makeError(
            'TOO_FEW_OPTIONS',
            'options',
            `Add at least ${MIN_OPTIONS} options.`,
          ),
        )
      } else if (input.options.length > MAX_OPTIONS) {
        errors.push(
          makeError(
            'TOO_MANY_OPTIONS',
            'options',
            `Use no more than ${MAX_OPTIONS} options.`,
          ),
        )
      }

      const seenIds = new Set<string>()
      const seenNames = new Set<string>()
      const expectedCriterionIds = [...new Set(criterionIds)]
      const expectedIdSet = new Set(expectedCriterionIds)
      const canValidateScoreKeys = Array.isArray(input.criteria)

      input.options.forEach((candidate, index) => {
        const path = `options[${index}]`
        if (!isPlainRecord(candidate)) {
          errors.push(
            makeError(
              'INVALID_SHAPE',
              path,
              'Each option must be a plain object.',
            ),
          )
          return
        }

        const id = candidate.id
        const name = candidate.name
        const scores = candidate.scores

        const idIsValid = validateId(
          id,
          `${path}.id`,
          'Option',
          errors,
        )
        if (idIsValid) {
          if (seenIds.has(id)) {
            errors.push(
              makeError(
                'DUPLICATE_ID',
                `${path}.id`,
                `Option ID “${id}” is already in use.`,
              ),
            )
          } else {
            seenIds.add(id)
          }
        }

        const nameIsValid = validateName(
          name,
          `${path}.name`,
          'Option',
          errors,
        )
        if (nameIsValid) {
          const nameKey = comparableName(name)
          if (seenNames.has(nameKey)) {
            errors.push(
              makeError(
                'DUPLICATE_NAME',
                `${path}.name`,
                `Option name “${name.trim()}” is already in use.`,
              ),
            )
          } else {
            seenNames.add(nameKey)
          }
        }

        if (!isPlainRecord(scores)) {
          errors.push(
            makeError(
              'INVALID_SHAPE',
              `${path}.scores`,
              'Option scores must be a plain object.',
            ),
          )
          return
        }

        const canonicalScores: Record<string, number> = {}
        if (canValidateScoreKeys) {
          expectedCriterionIds.forEach((criterionId) => {
            const scorePath = `${path}.scores.${criterionId}`
            if (!hasOwn(scores, criterionId)) {
              errors.push(
                makeError(
                  'SCORE_MISSING',
                  scorePath,
                  `A score is required for criterion “${criterionId}”.`,
                ),
              )
              return
            }

            const score = scores[criterionId]
            if (validateScore(score, scorePath, errors)) {
              canonicalScores[criterionId] = score
            }
          })

          Object.keys(scores)
            .filter((criterionId) => !expectedIdSet.has(criterionId))
            .sort()
            .forEach((criterionId) => {
              errors.push(
                makeError(
                  'UNKNOWN_SCORE_CRITERION',
                  `${path}.scores.${criterionId}`,
                  `No criterion exists for score “${criterionId}”.`,
                ),
              )
            })
        }

        if (idIsValid && nameIsValid) {
          validOptions.push({
            id,
            name: name.trim(),
            scores: canonicalScores,
          })
        }
      })
    }

    if (allWeightsValid && weightTotal !== TOTAL_WEIGHT_BP) {
      errors.push(
        makeError(
          'WEIGHTS_MUST_TOTAL_100_PERCENT',
          'criteria',
          `Criterion weights must total exactly ${TOTAL_WEIGHT_BP} basis points.`,
        ),
      )
    }

    if (errors.length > 0 || !titleIsValid) return failure(errors)

    return {
      ok: true,
      value: {
        schemaVersion: DECISION_SCHEMA_VERSION,
        title: title.trim(),
        criteria: validCriteria,
        options: validOptions,
      },
    }
  } catch {
    return failure([
      makeError(
        'INVALID_SHAPE',
        '',
        'Decision could not be read as structured data.',
      ),
    ])
  }
}
