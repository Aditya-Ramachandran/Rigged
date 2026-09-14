import {
  MAX_CRITERIA,
  MAX_ID_CODE_POINTS,
  MAX_NAME_CODE_POINTS,
  MIN_CRITERIA,
  TOTAL_WEIGHT_BP,
} from './constants'
import type { DomainError, DomainErrorCode, DomainResult } from './result'
import type { Criterion, CriterionId, WeightBp } from './types'

export interface RebalanceWeightsRequest {
  readonly criteria: readonly Criterion[]
  readonly criterionId: CriterionId
  readonly targetWeightBp: WeightBp
}

export interface WeightChange {
  readonly criterionId: CriterionId
  readonly fromWeightBp: WeightBp
  readonly toWeightBp: WeightBp
}

export interface RebalanceWeightsValue {
  readonly criteria: readonly Criterion[]
  readonly changed: readonly WeightChange[]
}

type UnknownRecord = Record<string, unknown>

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

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

const codePointLength = (value: string): number => Array.from(value).length
const comparableName = (value: string): string =>
  value.trim().normalize('NFKC').toLowerCase()

const error = (
  code: DomainErrorCode,
  path: string,
  message: string,
): DomainError => ({ code, path, message })

const failure = (
  errors: readonly DomainError[],
): DomainResult<RebalanceWeightsValue> => ({ ok: false, errors })

interface ValidatedRequest {
  readonly criteria: readonly Criterion[]
  readonly targetIndex: number
  readonly targetWeightBp: WeightBp
}

function validateRequest(input: unknown): DomainResult<ValidatedRequest> {
  try {
    if (!isPlainRecord(input)) {
      return {
        ok: false,
        errors: [
          error('INVALID_SHAPE', '', 'Rebalance request must be a plain object.'),
        ],
      }
    }

    const errors: DomainError[] = []
    const criteriaInput = input.criteria
    const criterionId = input.criterionId
    const targetWeightBp = input.targetWeightBp
    const validCriteria: Criterion[] = []
    let allWeightsValid = true
    let weightTotal = 0

    if (!Array.isArray(criteriaInput)) {
      errors.push(
        error('INVALID_SHAPE', 'criteria', 'Criteria must be an array.'),
      )
      allWeightsValid = false
    } else {
      if (criteriaInput.length < MIN_CRITERIA) {
        errors.push(
          error(
            'TOO_FEW_CRITERIA',
            'criteria',
            `Add at least ${MIN_CRITERIA} criteria.`,
          ),
        )
      } else if (criteriaInput.length > MAX_CRITERIA) {
        errors.push(
          error(
            'TOO_MANY_CRITERIA',
            'criteria',
            `Use no more than ${MAX_CRITERIA} criteria.`,
          ),
        )
      }

      const seenIds = new Set<string>()
      const seenNames = new Set<string>()

      criteriaInput.forEach((candidate, index) => {
        const path = `criteria[${index}]`
        if (!isPlainRecord(candidate)) {
          errors.push(
            error(
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

        let idIsValid = true
        if (typeof id !== 'string' || id.trim().length === 0) {
          errors.push(error('ID_REQUIRED', `${path}.id`, 'Criterion needs an ID.'))
          idIsValid = false
        } else if (codePointLength(id) > MAX_ID_CODE_POINTS) {
          errors.push(
            error(
              'INVALID_SHAPE',
              `${path}.id`,
              `Criterion ID cannot exceed ${MAX_ID_CODE_POINTS} characters.`,
            ),
          )
          idIsValid = false
        }

        if (idIsValid) {
          if (seenIds.has(id as string)) {
            errors.push(
              error(
                'DUPLICATE_ID',
                `${path}.id`,
                `Criterion ID “${id as string}” is already in use.`,
              ),
            )
          } else {
            seenIds.add(id as string)
          }
        }

        let nameIsValid = true
        if (typeof name !== 'string' || name.trim().length === 0) {
          errors.push(
            error('NAME_REQUIRED', `${path}.name`, 'Criterion needs a name.'),
          )
          nameIsValid = false
        } else if (codePointLength(name.trim()) > MAX_NAME_CODE_POINTS) {
          errors.push(
            error(
              'NAME_TOO_LONG',
              `${path}.name`,
              `Criterion name cannot exceed ${MAX_NAME_CODE_POINTS} characters.`,
            ),
          )
          nameIsValid = false
        } else if (hasForbiddenControlCharacter(name)) {
          errors.push(
            error(
              'INVALID_SHAPE',
              `${path}.name`,
              'Criterion name cannot contain control characters.',
            ),
          )
          nameIsValid = false
        }

        if (nameIsValid) {
          const nameKey = comparableName(name as string)
          if (seenNames.has(nameKey)) {
            errors.push(
              error(
                'DUPLICATE_NAME',
                `${path}.name`,
                `Criterion name “${(name as string).trim()}” is already in use.`,
              ),
            )
          } else {
            seenNames.add(nameKey)
          }
        }

        let weightIsValid = true
        if (
          typeof weightBp !== 'number' ||
          !Number.isFinite(weightBp) ||
          !Number.isInteger(weightBp)
        ) {
          errors.push(
            error(
              'WEIGHT_NOT_INTEGER',
              `${path}.weightBp`,
              'Weight must be a whole number of basis points.',
            ),
          )
          weightIsValid = false
          allWeightsValid = false
        } else if (weightBp < 0 || weightBp > TOTAL_WEIGHT_BP) {
          errors.push(
            error(
              'WEIGHT_OUT_OF_RANGE',
              `${path}.weightBp`,
              `Weight must be between 0 and ${TOTAL_WEIGHT_BP} basis points.`,
            ),
          )
          weightIsValid = false
          allWeightsValid = false
        } else {
          weightTotal += weightBp
        }

        if (idIsValid && nameIsValid && weightIsValid) {
          validCriteria.push({
            id: id as string,
            name: name as string,
            weightBp: weightBp as number,
          })
        }
      })
    }

    let criterionIdIsValid = true
    if (typeof criterionId !== 'string' || criterionId.trim().length === 0) {
      errors.push(
        error('ID_REQUIRED', 'criterionId', 'Target criterion ID is required.'),
      )
      criterionIdIsValid = false
    }

    let targetWeightIsValid = true
    if (
      typeof targetWeightBp !== 'number' ||
      !Number.isFinite(targetWeightBp) ||
      !Number.isInteger(targetWeightBp)
    ) {
      errors.push(
        error(
          'TARGET_WEIGHT_NOT_INTEGER',
          'targetWeightBp',
          'Target weight must be a whole number of basis points.',
        ),
      )
      targetWeightIsValid = false
    } else if (targetWeightBp < 0 || targetWeightBp > TOTAL_WEIGHT_BP) {
      errors.push(
        error(
          'TARGET_WEIGHT_OUT_OF_RANGE',
          'targetWeightBp',
          `Target weight must be between 0 and ${TOTAL_WEIGHT_BP} basis points.`,
        ),
      )
      targetWeightIsValid = false
    }

    if (allWeightsValid && weightTotal !== TOTAL_WEIGHT_BP) {
      errors.push(
        error(
          'WEIGHTS_MUST_TOTAL_100_PERCENT',
          'criteria',
          `Criterion weights must total exactly ${TOTAL_WEIGHT_BP} basis points.`,
        ),
      )
    }

    const targetIndex = criterionIdIsValid
      ? validCriteria.findIndex(({ id }) => id === criterionId)
      : -1
    if (
      criterionIdIsValid &&
      Array.isArray(criteriaInput) &&
      targetIndex === -1
    ) {
      errors.push(
        error(
          'CRITERION_NOT_FOUND',
          'criterionId',
          `Criterion “${criterionId as string}” was not found.`,
        ),
      )
    }

    if (errors.length > 0 || !targetWeightIsValid) {
      return { ok: false, errors }
    }

    return {
      ok: true,
      value: {
        criteria: validCriteria,
        targetIndex,
        targetWeightBp: targetWeightBp as number,
      },
    }
  } catch {
    return {
      ok: false,
      errors: [
        error(
          'INVALID_SHAPE',
          '',
          'Rebalance request could not be read as structured data.',
        ),
      ],
    }
  }
}

/** Rebalances one weight while preserving an exact 10,000 bp total. */
export function rebalanceWeights(
  request: RebalanceWeightsRequest,
): DomainResult<RebalanceWeightsValue> {
  const validated = validateRequest(request)
  if (!validated.ok) return failure(validated.errors)

  const { criteria, targetIndex, targetWeightBp } = validated.value
  const oldTargetWeightBp = criteria[targetIndex]!.weightBp
  const oldOtherTotal = TOTAL_WEIGHT_BP - oldTargetWeightBp
  const remaining = TOTAL_WEIGHT_BP - targetWeightBp
  const nextWeights = criteria.map(({ weightBp }) => weightBp)
  nextWeights[targetIndex] = targetWeightBp

  const otherIndices = criteria
    .map((_, index) => index)
    .filter((index) => index !== targetIndex)

  if (oldOtherTotal === 0) {
    const evenShare = Math.floor(remaining / otherIndices.length)
    const leftover = remaining % otherIndices.length
    otherIndices.forEach((index, order) => {
      nextWeights[index] = evenShare + (order < leftover ? 1 : 0)
    })
  } else {
    const quotas = otherIndices.map((index) => {
      const numerator = criteria[index]!.weightBp * remaining
      return {
        index,
        floor: Math.floor(numerator / oldOtherTotal),
        remainder: numerator % oldOtherTotal,
      }
    })

    quotas.forEach(({ index, floor }) => {
      nextWeights[index] = floor
    })

    const assigned = quotas.reduce((sum, { floor }) => sum + floor, 0)
    const leftover = remaining - assigned
    quotas
      .slice()
      .sort(
        (left, right) =>
          right.remainder - left.remainder || left.index - right.index,
      )
      .slice(0, leftover)
      .forEach(({ index }) => {
        nextWeights[index]! += 1
      })
  }

  const nextCriteria = criteria.map((criterion, index) => ({
    id: criterion.id,
    name: criterion.name,
    weightBp: nextWeights[index]!,
  }))
  const changed = criteria.flatMap((criterion, index) => {
    const toWeightBp = nextWeights[index]!
    return criterion.weightBp === toWeightBp
      ? []
      : [
          {
            criterionId: criterion.id,
            fromWeightBp: criterion.weightBp,
            toWeightBp,
          },
        ]
  })

  return { ok: true, value: { criteria: nextCriteria, changed } }
}
