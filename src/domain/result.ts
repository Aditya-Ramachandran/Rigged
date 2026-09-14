export type DomainErrorCode =
  | 'INVALID_SHAPE'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'TITLE_REQUIRED'
  | 'TOO_FEW_CRITERIA'
  | 'TOO_MANY_CRITERIA'
  | 'TOO_FEW_OPTIONS'
  | 'TOO_MANY_OPTIONS'
  | 'ID_REQUIRED'
  | 'DUPLICATE_ID'
  | 'NAME_REQUIRED'
  | 'NAME_TOO_LONG'
  | 'DUPLICATE_NAME'
  | 'WEIGHT_NOT_INTEGER'
  | 'WEIGHT_OUT_OF_RANGE'
  | 'WEIGHTS_MUST_TOTAL_100_PERCENT'
  | 'SCORE_MISSING'
  | 'SCORE_NOT_INTEGER'
  | 'SCORE_OUT_OF_RANGE'
  | 'UNKNOWN_SCORE_CRITERION'
  | 'CRITERION_NOT_FOUND'
  | 'TARGET_WEIGHT_NOT_INTEGER'
  | 'TARGET_WEIGHT_OUT_OF_RANGE'
  | 'ANALYSIS_MISMATCH'

export interface DomainError {
  readonly code: DomainErrorCode
  readonly path: string
  readonly message: string
}

export type DomainResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly DomainError[] }
