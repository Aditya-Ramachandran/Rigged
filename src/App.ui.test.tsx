// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
})

describe('decision controls', () => {
  it('keeps priority weights at exactly 100% after a rail edit', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText(/Adjust Compensation weight/i), { target: { value: '4000' } })
    expect(screen.getByText('100% total')).toBeTruthy()
  })
})
