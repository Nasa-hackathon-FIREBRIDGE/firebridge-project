/**
 * Generalised linear models fitted by penalised iteratively reweighted least squares
 * (Newton-Raphson). The intercept (column 0) is not penalised. Deterministic: the same
 * inputs always give the same coefficients.
 */
export type Family = 'poisson' | 'logistic'

export interface GlmFit {
  family: Family
  weights: number[]
  iterations: number
  converged: boolean
}

const MAX_LINEAR = 30

export function linear(weights: readonly number[], x: readonly number[]) {
  let z = 0
  for (let j = 0; j < weights.length; j++) z += weights[j] * x[j]
  return Math.max(-MAX_LINEAR, Math.min(MAX_LINEAR, z))
}

export function predict(fit: GlmFit, x: readonly number[]) {
  const z = linear(fit.weights, x)
  return fit.family === 'poisson' ? Math.exp(z) : 1 / (1 + Math.exp(-z))
}

/** Solve A·v = b in place with partial pivoting; returns null for a singular system. */
function solve(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length
  const a = matrix.map((row, i) => [...row, vector[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
    if (Math.abs(a[pivot][col]) < 1e-12) return null
    ;[a[col], a[pivot]] = [a[pivot], a[col]]
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = a[row][col] / a[col][col]
      if (factor === 0) continue
      for (let k = col; k <= n; k++) a[row][k] -= factor * a[col][k]
    }
  }
  return a.map((row, i) => row[n] / row[i])
}

export function fitGlm(
  x: readonly (readonly number[])[],
  y: readonly number[],
  family: Family,
  options: { l2?: number; maxIterations?: number; tolerance?: number; init?: readonly number[] } = {},
): GlmFit {
  const { l2 = 1, maxIterations = 60, tolerance = 1e-8 } = options
  const d = x[0]?.length ?? 1
  let weights = options.init ? [...options.init] : new Array<number>(d).fill(0)
  if (!options.init && y.length) {
    const meanY = y.reduce((sum, value) => sum + value, 0) / y.length
    weights[0] = family === 'poisson' ? Math.log(Math.max(meanY, 1e-3)) : Math.log(Math.max(meanY, 1e-3) / Math.max(1 - meanY, 1e-3))
  }
  let iterations = 0
  let converged = false
  for (; iterations < maxIterations; iterations++) {
    const gradient = new Array<number>(d).fill(0)
    const hessian = Array.from({ length: d }, () => new Array<number>(d).fill(0))
    for (let i = 0; i < x.length; i++) {
      const row = x[i]
      const z = linear(weights, row)
      const mu = family === 'poisson' ? Math.exp(z) : 1 / (1 + Math.exp(-z))
      const w = family === 'poisson' ? mu : mu * (1 - mu)
      const residual = mu - y[i]
      for (let j = 0; j < d; j++) {
        gradient[j] += residual * row[j]
        const wj = w * row[j]
        for (let k = j; k < d; k++) hessian[j][k] += wj * row[k]
      }
    }
    for (let j = 0; j < d; j++) for (let k = 0; k < j; k++) hessian[j][k] = hessian[k][j]
    for (let j = 1; j < d; j++) {
      gradient[j] += l2 * weights[j]
      hessian[j][j] += l2
    }
    hessian[0][0] += 1e-9
    const step = solve(hessian, gradient)
    if (!step) break
    weights = weights.map((value, j) => value - step[j])
    if (Math.max(...step.map(Math.abs)) < tolerance) {
      converged = true
      iterations++
      break
    }
  }
  return { family, weights, iterations, converged }
}
