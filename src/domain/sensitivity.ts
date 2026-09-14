import {
  computeWeightedScoresValidated,
  type WeightedScoresValue,
} from './computeWeightedScores'
import { rebalanceValidatedCriteria } from './rebalanceWeights'
import type { DomainResult } from './result'
import type { CriterionId, Decision, OptionId, WeightBp } from './types'
import { validateDecision } from './validateDecision'

export const MAX_SHIFT_BP = 3_000 as const
export const STEP_BP = 1 as const

export type FragilityBand =
  | 'tied'
  | 'hair_trigger'
  | 'fragile'
  | 'sensitive'
  | 'steady'
  | 'robust'
  | 'stable_within_range'

export interface SensitivityShift {
  readonly criterionId: CriterionId
  readonly direction: 'decrease' | 'increase'
  readonly fromWeightBp: WeightBp
  readonly toWeightBp: WeightBp
  readonly deltaBp: number
  readonly thresholdKind: 'tie' | 'new_winner'
  readonly resultingTopOptionIds: readonly OptionId[]
  readonly primaryChallengerId: OptionId
  readonly trialWeights: readonly {
    readonly criterionId: CriterionId
    readonly weightBp: WeightBp
  }[]
}

export type SensitivityValue =
  | {
      readonly status: 'baseline_tie'
      readonly baselineTopOptionIds: readonly OptionId[]
      readonly baselineWinnerId: null
      readonly testedMaxShiftBp: typeof MAX_SHIFT_BP
      readonly fragilityBand: 'tied'
      readonly primaryShift: null
      readonly nearestShifts: readonly []
    }
  | {
      readonly status: 'flip_found'
      readonly baselineTopOptionIds: readonly [OptionId]
      readonly baselineWinnerId: OptionId
      readonly testedMaxShiftBp: typeof MAX_SHIFT_BP
      readonly fragilityBand: Exclude<
        FragilityBand,
        'tied' | 'stable_within_range'
      >
      readonly primaryShift: SensitivityShift
      readonly nearestShifts: readonly SensitivityShift[]
    }
  | {
      readonly status: 'stable_within_range'
      readonly baselineTopOptionIds: readonly [OptionId]
      readonly baselineWinnerId: OptionId
      readonly testedMaxShiftBp: typeof MAX_SHIFT_BP
      readonly fragilityBand: 'stable_within_range'
      readonly primaryShift: null
      readonly nearestShifts: readonly []
    }

function fragilityBandForDistance(
  distanceBp: number,
): Exclude<FragilityBand, 'tied' | 'stable_within_range'> {
  if (distanceBp <= 200) return 'hair_trigger'
  if (distanceBp <= 500) return 'fragile'
  if (distanceBp <= 1_000) return 'sensitive'
  if (distanceBp <= 2_000) return 'steady'
  return 'robust'
}

function computeTrialTopOptionIds(decision: Decision): OptionId[] {
  let topUnits = Number.NEGATIVE_INFINITY
  const topOptionIds: OptionId[] = []

  decision.options.forEach((option) => {
    const totalUnits = decision.criteria.reduce(
      (sum, criterion) =>
        sum + criterion.weightBp * option.scores[criterion.id]!,
      0,
    )

    if (totalUnits > topUnits) {
      topUnits = totalUnits
      topOptionIds.splice(0, topOptionIds.length, option.id)
    } else if (totalUnits === topUnits) {
      topOptionIds.push(option.id)
    }
  })

  return topOptionIds
}

function analyzeValidatedDecision(
  decision: Decision,
  baseline: WeightedScoresValue,
): SensitivityValue {
  if (baseline.winnerId === null) {
    return {
      status: 'baseline_tie',
      baselineTopOptionIds: baseline.topOptionIds,
      baselineWinnerId: null,
      testedMaxShiftBp: MAX_SHIFT_BP,
      fragilityBand: 'tied',
      primaryShift: null,
      nearestShifts: [],
    }
  }

  const baselineWinnerId = baseline.winnerId
  const criterionOrder = new Map(
    decision.criteria.map(({ id }, index) => [id, index]),
  )
  const optionOrder = new Map(
    decision.options.map(({ id }, index) => [id, index]),
  )

  for (
    let distanceBp = STEP_BP;
    distanceBp <= MAX_SHIFT_BP;
    distanceBp += STEP_BP
  ) {
    const candidates: SensitivityShift[] = []

    decision.criteria.forEach((criterion, criterionIndex) => {
      const directions = [
        { direction: 'decrease' as const, deltaBp: -distanceBp },
        { direction: 'increase' as const, deltaBp: distanceBp },
      ]

      directions.forEach(({ direction, deltaBp }) => {
        const toWeightBp = criterion.weightBp + deltaBp
        if (toWeightBp < 0 || toWeightBp > 10_000) return

        const rebalanced = rebalanceValidatedCriteria(
          decision.criteria,
          criterionIndex,
          toWeightBp,
        )
        const trialDecision: Decision = {
          ...decision,
          criteria: rebalanced.criteria,
        }
        const resultingTopOptionIds = computeTrialTopOptionIds(trialDecision)
        const remainsSoleWinner =
          resultingTopOptionIds.length === 1 &&
          resultingTopOptionIds[0] === baselineWinnerId
        if (remainsSoleWinner) return

        const primaryChallengerId = resultingTopOptionIds.find(
          (optionId) => optionId !== baselineWinnerId,
        )
        if (primaryChallengerId === undefined) return

        candidates.push({
          criterionId: criterion.id,
          direction,
          fromWeightBp: criterion.weightBp,
          toWeightBp,
          deltaBp,
          thresholdKind: resultingTopOptionIds.includes(baselineWinnerId)
            ? 'tie'
            : 'new_winner',
          resultingTopOptionIds,
          primaryChallengerId,
          trialWeights: rebalanced.criteria.map(({ id, weightBp }) => ({
            criterionId: id,
            weightBp,
          })),
        })
      })
    })

    if (candidates.length > 0) {
      candidates.sort((left, right) => {
        const criterionDifference =
          criterionOrder.get(left.criterionId)! -
          criterionOrder.get(right.criterionId)!
        if (criterionDifference !== 0) return criterionDifference

        const directionDifference =
          (left.direction === 'decrease' ? 0 : 1) -
          (right.direction === 'decrease' ? 0 : 1)
        if (directionDifference !== 0) return directionDifference

        return (
          optionOrder.get(left.primaryChallengerId)! -
          optionOrder.get(right.primaryChallengerId)!
        )
      })

      return {
        status: 'flip_found',
        baselineTopOptionIds: [baselineWinnerId],
        baselineWinnerId,
        testedMaxShiftBp: MAX_SHIFT_BP,
        fragilityBand: fragilityBandForDistance(distanceBp),
        primaryShift: candidates[0]!,
        nearestShifts: candidates,
      }
    }
  }

  return {
    status: 'stable_within_range',
    baselineTopOptionIds: [baselineWinnerId],
    baselineWinnerId,
    testedMaxShiftBp: MAX_SHIFT_BP,
    fragilityBand: 'stable_within_range',
    primaryShift: null,
    nearestShifts: [],
  }
}

/** Finds the smallest single-weight change on the locked 1 bp lattice. */
export function runSensitivityAnalysis(
  decision: Decision,
): DomainResult<SensitivityValue> {
  const validated = validateDecision(decision)
  if (!validated.ok) return validated

  const baseline = computeWeightedScoresValidated(validated.value)
  return {
    ok: true,
    value: analyzeValidatedDecision(validated.value, baseline),
  }
}

export function runSensitivityAnalysisValidated(
  decision: Decision,
  baseline: WeightedScoresValue,
): SensitivityValue {
  return analyzeValidatedDecision(decision, baseline)
}
