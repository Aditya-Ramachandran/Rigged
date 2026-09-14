import {
  computeWeightedScoresValidated,
  type WeightedScoresValue,
} from './computeWeightedScores'
import type { DomainError, DomainResult } from './result'
import {
  runSensitivityAnalysisValidated,
  type FragilityBand,
  type SensitivityValue,
} from './sensitivity'
import type { Decision } from './types'
import { validateDecision } from './validateDecision'

export interface GenerateExplanationRequest {
  readonly decision: Decision
  readonly scores: WeightedScoresValue
  readonly sensitivity: SensitivityValue
}

export interface ExplanationValue {
  readonly verdictHeadline: string
  readonly verdictSummary: string
  readonly driverStatement: string | null
  readonly driverDetail: string | null
  readonly sensitivityStatement: string
  readonly fragilityLabel: string
  readonly methodNote: string
}

const METHOD_NOTE =
  'Sensitivity changes one priority at a time and rebalances the rest proportionally. It tests shifts up to 30 percentage points.'

const fragilityLabels: Readonly<Record<FragilityBand, string>> = {
  tied: 'No clear winner',
  hair_trigger: 'Hair-trigger',
  fragile: 'Fragile',
  sensitive: 'Sensitive',
  steady: 'Fairly steady',
  robust: 'Robust in this test',
  stable_within_range: 'Stable within ±30 pp',
}

type UnknownRecord = Record<string, unknown>

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const analysisMismatch = (path: string): DomainError => ({
  code: 'ANALYSIS_MISMATCH',
  path,
  message: `The provided ${path} does not match this decision.`,
})

const structurallyEqual = (left: unknown, right: unknown): boolean => {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

const formatPoints = (value: number): string => value.toFixed(2)
const formatWeight = (weightBp: number): string =>
  `${(weightBp / 100).toFixed(2).replace(/\.00$/u, '').replace(/(\.\d)0$/u, '$1')}%`
const formatSignedInteger = (value: number): string =>
  value >= 0 ? `+${value}` : String(value)
const formatSignedPoints = (value: number): string =>
  value >= 0 ? `+${formatPoints(value)}` : formatPoints(value)

function joinNames(names: readonly string[]): string {
  if (names.length === 1) return names[0]!
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`
}

/** Produces the locked plain-text explanation after coherence checks. */
export function generateExplanation(
  request: GenerateExplanationRequest,
): DomainResult<ExplanationValue> {
  try {
    if (!isPlainRecord(request)) {
      return {
        ok: false,
        errors: [
          {
            code: 'INVALID_SHAPE',
            path: '',
            message: 'Explanation request must be a plain object.',
          },
        ],
      }
    }

    const validated = validateDecision(request.decision)
    if (!validated.ok) return validated

    const decision = validated.value
    const freshScores = computeWeightedScoresValidated(decision)
    const freshSensitivity = runSensitivityAnalysisValidated(
      decision,
      freshScores,
    )
    const mismatchErrors: DomainError[] = []
    if (!structurallyEqual(request.scores, freshScores)) {
      mismatchErrors.push(analysisMismatch('scores'))
    }
    if (!structurallyEqual(request.sensitivity, freshSensitivity)) {
      mismatchErrors.push(analysisMismatch('sensitivity'))
    }
    if (mismatchErrors.length > 0) {
      return { ok: false, errors: mismatchErrors }
    }

    const optionNames = new Map(
      decision.options.map(({ id, name }) => [id, name]),
    )
    const criterionById = new Map(
      decision.criteria.map((criterion) => [criterion.id, criterion]),
    )

    if (freshScores.winnerId === null) {
      const topNames = freshScores.topOptionIds.map(
        (optionId) => optionNames.get(optionId)!,
      )
      const tieStatement = `${joinNames(topNames)} are level. Your current priorities do not produce a single winner.`
      return {
        ok: true,
        value: {
          verdictHeadline: 'No clear winner.',
          verdictSummary: tieStatement,
          driverStatement: null,
          driverDetail: null,
          sensitivityStatement:
            'The result is already tied, so there is no single winner to stress-test.',
          fragilityLabel: fragilityLabels.tied,
          methodNote: METHOD_NOTE,
        },
      }
    }

    const winnerId = freshScores.winnerId
    const winnerName = optionNames.get(winnerId)!
    const runnerUpId = freshScores.runnerUpOptionIds[0]!
    const runnerUpName = optionNames.get(runnerUpId)!
    const marginUnits = freshScores.marginUnits!
    const marginPoints = formatPoints(freshScores.marginPoints!)
    const driver = freshScores.driver!
    const driverCriterion = criterionById.get(driver.criterionId)!
    const winner = decision.options.find(({ id }) => id === winnerId)!
    const runnerUp = decision.options.find(({ id }) => id === runnerUpId)!
    const scoreGap =
      winner.scores[driver.criterionId]! - runnerUp.scores[driver.criterionId]!

    let sensitivityStatement: string
    if (freshSensitivity.status === 'flip_found') {
      const shift = freshSensitivity.primaryShift
      const criterionName = criterionById.get(shift.criterionId)!.name
      const challengerName = optionNames.get(shift.primaryChallengerId)!
      const action = shift.direction === 'increase' ? 'Raise' : 'Lower'
      const outcome =
        shift.thresholdKind === 'tie'
          ? `${challengerName} draws level with ${winnerName}`
          : `${challengerName} takes the lead`
      sensitivityStatement = `${action} ${criterionName} from ${formatWeight(shift.fromWeightBp)} to ${formatWeight(shift.toWeightBp)}, and ${outcome}.`
    } else {
      sensitivityStatement = `No single priority shift up to 30 percentage points dislodges ${winnerName}. The result is stable within the tested range.`
    }

    return {
      ok: true,
      value: {
        verdictHeadline: `${winnerName} wins.`,
        verdictSummary:
          marginUnits < 2_500
            ? `Only ${marginPoints} points separate it from ${runnerUpName}. That answer deserves a closer look.`
            : `It leads ${runnerUpName} by ${marginPoints} points after every priority is accounted for.`,
        driverStatement: `${driverCriterion.name} is doing the heavy lifting for ${winnerName} against ${runnerUpName}.`,
        driverDetail: `${formatWeight(driverCriterion.weightBp)} weight × ${formatSignedInteger(scoreGap)}-point score gap = ${formatSignedPoints(driver.marginContributionPoints)}-point contribution to the lead.`,
        sensitivityStatement,
        fragilityLabel: fragilityLabels[freshSensitivity.fragilityBand],
        methodNote: METHOD_NOTE,
      },
    }
  } catch {
    return {
      ok: false,
      errors: [
        {
          code: 'INVALID_SHAPE',
          path: '',
          message: 'Explanation request could not be read as structured data.',
        },
      ],
    }
  }
}
