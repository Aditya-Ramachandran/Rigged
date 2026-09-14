export const DECISION_SCHEMA_VERSION = 1 as const

export type CriterionId = string
export type OptionId = string

/** An integer percentage measured in basis points: 10,000 bp = 100%. */
export type WeightBp = number
export type Score = number

export interface Criterion {
  readonly id: CriterionId
  readonly name: string
  readonly weightBp: WeightBp
}

export interface DecisionOption {
  readonly id: OptionId
  readonly name: string
  readonly scores: Readonly<Record<CriterionId, Score>>
}

export interface Decision {
  readonly schemaVersion: typeof DECISION_SCHEMA_VERSION
  readonly title: string
  readonly criteria: readonly Criterion[]
  readonly options: readonly DecisionOption[]
}

export type ThemePreference = 'light' | 'dark'

export interface AppState {
  readonly decision: Decision
  readonly appearance: {
    readonly theme: ThemePreference
    readonly source: 'system' | 'manual'
  }
  readonly persistence: {
    readonly status: 'idle' | 'saved' | 'unavailable' | 'recovered-invalid'
  }
}
