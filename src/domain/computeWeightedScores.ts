import type { DomainResult } from './result'
import type { CriterionId, Decision, OptionId, Score, WeightBp } from './types'
import { validateDecision } from './validateDecision'

export interface CriterionContribution {
  readonly criterionId: CriterionId
  readonly score: Score
  readonly weightBp: WeightBp
  readonly contributionUnits: number
  readonly contributionPoints: number
}

export interface RankedOption {
  readonly optionId: OptionId
  readonly totalUnits: number
  readonly totalPoints: number
  readonly rank: number
  readonly contributions: readonly CriterionContribution[]
}

export interface DriverResult {
  readonly criterionId: CriterionId
  readonly winnerId: OptionId
  readonly runnerUpId: OptionId
  readonly marginContributionUnits: number
  readonly marginContributionPoints: number
}

export interface WeightedScoresValue {
  readonly ranking: readonly RankedOption[]
  readonly topOptionIds: readonly OptionId[]
  readonly winnerId: OptionId | null
  readonly runnerUpOptionIds: readonly OptionId[]
  readonly marginUnits: number | null
  readonly marginPoints: number | null
  readonly driver: DriverResult | null
}

interface RankedWithInputOrder extends RankedOption {
  readonly inputIndex: number
}

/** Internal validated-input path shared by the bounded sensitivity search. */
export function computeWeightedScoresValidated(
  canonicalDecision: Decision,
): WeightedScoresValue {
  const rankedWithInputOrder: RankedWithInputOrder[] =
    canonicalDecision.options.map((option, inputIndex) => {
      const contributions = canonicalDecision.criteria.map((criterion) => {
        const score = option.scores[criterion.id]!
        const contributionUnits = criterion.weightBp * score
        return {
          criterionId: criterion.id,
          score,
          weightBp: criterion.weightBp,
          contributionUnits,
          contributionPoints: contributionUnits / 10_000,
        }
      })
      const totalUnits = contributions.reduce(
        (sum, contribution) => sum + contribution.contributionUnits,
        0,
      )

      return {
        optionId: option.id,
        totalUnits,
        totalPoints: totalUnits / 10_000,
        rank: 0,
        contributions,
        inputIndex,
      }
    })

  rankedWithInputOrder.sort(
    (left, right) =>
      right.totalUnits - left.totalUnits || left.inputIndex - right.inputIndex,
  )

  let previousTotal: number | null = null
  let previousRank = 0
  const ranking = rankedWithInputOrder.map((option, index): RankedOption => {
    const rank =
      previousTotal === option.totalUnits ? previousRank : index + 1
    previousTotal = option.totalUnits
    previousRank = rank

    return {
      optionId: option.optionId,
      totalUnits: option.totalUnits,
      totalPoints: option.totalPoints,
      rank,
      contributions: option.contributions,
    }
  })

  const topTotal = ranking[0]!.totalUnits
  const topOptionIds = ranking
    .filter(({ totalUnits }) => totalUnits === topTotal)
    .map(({ optionId }) => optionId)

  if (topOptionIds.length !== 1) {
    return {
      ranking,
      topOptionIds,
      winnerId: null,
      runnerUpOptionIds: [],
      marginUnits: null,
      marginPoints: null,
      driver: null,
    }
  }

  const winnerId = topOptionIds[0]!
  const runnerUpTotal = ranking[1]!.totalUnits
  const runnerUpOptionIds = ranking
    .filter(({ totalUnits }) => totalUnits === runnerUpTotal)
    .map(({ optionId }) => optionId)
  const primaryRunnerUpId = runnerUpOptionIds[0]!
  const winner = canonicalDecision.options.find(({ id }) => id === winnerId)!
  const primaryRunnerUp = canonicalDecision.options.find(
    ({ id }) => id === primaryRunnerUpId,
  )!
  const marginUnits = topTotal - runnerUpTotal

  let driver: DriverResult | null = null
  canonicalDecision.criteria.forEach((criterion) => {
    const marginContributionUnits =
      criterion.weightBp *
      (winner.scores[criterion.id]! - primaryRunnerUp.scores[criterion.id]!)

    if (
      marginContributionUnits > 0 &&
      (driver === null ||
        marginContributionUnits > driver.marginContributionUnits)
    ) {
      driver = {
        criterionId: criterion.id,
        winnerId,
        runnerUpId: primaryRunnerUpId,
        marginContributionUnits,
        marginContributionPoints: marginContributionUnits / 10_000,
      }
    }
  })

  return {
    ranking,
    topOptionIds,
    winnerId,
    runnerUpOptionIds,
    marginUnits,
    marginPoints: marginUnits / 10_000,
    driver,
  }
}

/** Computes the authoritative ranking using integer contribution units. */
export function computeWeightedScores(
  decision: Decision,
): DomainResult<WeightedScoresValue> {
  const validated = validateDecision(decision)
  if (!validated.ok) return validated

  return { ok: true, value: computeWeightedScoresValidated(validated.value) }
}
