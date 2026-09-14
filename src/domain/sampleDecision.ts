import type { Decision } from './types'

export const SAMPLE_DECISION = {
  schemaVersion: 1,
  title: 'Choose a job offer',
  criteria: [
    { id: 'compensation', name: 'Compensation', weightBp: 3_500 },
    { id: 'growth', name: 'Growth', weightBp: 2_500 },
    { id: 'balance', name: 'Balance', weightBp: 2_500 },
    { id: 'mission', name: 'Mission', weightBp: 1_500 },
  ],
  options: [
    {
      id: 'northstar',
      name: 'Northstar Labs',
      scores: { compensation: 9, growth: 8, balance: 5, mission: 6 },
    },
    {
      id: 'civic',
      name: 'Civic Studio',
      scores: { compensation: 6, growth: 7, balance: 9, mission: 9 },
    },
    {
      id: 'atlas',
      name: 'Atlas Health',
      scores: { compensation: 8, growth: 6, balance: 7, mission: 8 },
    },
  ],
} as const satisfies Decision
