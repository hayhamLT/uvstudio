// ---------------------------------------------------------------------------
// Small sparse linear-algebra helpers (COO matrices + conjugate gradient).
// Everything is hand-rolled so it runs anywhere, including inside a Worker.
// ---------------------------------------------------------------------------

/** A sparse matrix in coordinate (triplet) form. */
export class COO {
  rows: number[] = []
  cols: number[] = []
  vals: number[] = []
  nRows: number
  nCols: number

  constructor(nRows: number, nCols: number) {
    this.nRows = nRows
    this.nCols = nCols
  }

  add(r: number, c: number, v: number): void {
    if (v === 0) return
    this.rows.push(r)
    this.cols.push(c)
    this.vals.push(v)
  }

  /** y = A x (y length nRows) */
  matvec(x: Float64Array, out: Float64Array): void {
    out.fill(0)
    const { rows, cols, vals } = this
    for (let i = 0; i < vals.length; i++) out[rows[i]] += vals[i] * x[cols[i]]
  }

  /** y = Aᵀ x (y length nCols) */
  matvecT(x: Float64Array, out: Float64Array): void {
    out.fill(0)
    const { rows, cols, vals } = this
    for (let i = 0; i < vals.length; i++) out[cols[i]] += vals[i] * x[rows[i]]
  }
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/**
 * Solve the least-squares system min ||A x - b|| via CGLS (conjugate gradient
 * on the normal equations, without forming AᵀA).
 */
export function cgls(A: COO, b: Float64Array, iters = 400, tol = 1e-7): Float64Array {
  const n = A.nCols
  const m = A.nRows
  const x = new Float64Array(n)
  const r = new Float64Array(m)
  r.set(b) // r = b - A·0
  const s = new Float64Array(n)
  A.matvecT(r, s) // s = Aᵀ r
  const p = new Float64Array(n)
  p.set(s)
  let gamma = dot(s, s)
  const q = new Float64Array(m)
  const tol2 = tol * tol * (gamma || 1)
  for (let it = 0; it < iters && gamma > tol2; it++) {
    A.matvec(p, q)
    const denom = dot(q, q) || 1e-30
    const alpha = gamma / denom
    for (let i = 0; i < n; i++) x[i] += alpha * p[i]
    for (let i = 0; i < m; i++) r[i] -= alpha * q[i]
    A.matvecT(r, s)
    const gNew = dot(s, s)
    const beta = gNew / (gamma || 1e-30)
    for (let i = 0; i < n; i++) p[i] = s[i] + beta * p[i]
    gamma = gNew
  }
  return x
}

/**
 * Solve a symmetric positive-definite system A x = b with conjugate gradient.
 * Supports a warm start (x0) for fast re-solves across ARAP iterations.
 */
export function cgSPD(
  A: COO,
  b: Float64Array,
  x0?: Float64Array,
  iters = 300,
  tol = 1e-7,
): Float64Array {
  const n = A.nCols
  const x = x0 ? Float64Array.from(x0) : new Float64Array(n)
  const r = new Float64Array(n)
  const Ap = new Float64Array(n)
  A.matvec(x, Ap)
  for (let i = 0; i < n; i++) r[i] = b[i] - Ap[i]
  const p = Float64Array.from(r)
  let rs = dot(r, r)
  const tol2 = tol * tol * (dot(b, b) || 1)
  for (let it = 0; it < iters && rs > tol2; it++) {
    A.matvec(p, Ap)
    const alpha = rs / (dot(p, Ap) || 1e-30)
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i]
      r[i] -= alpha * Ap[i]
    }
    const rsNew = dot(r, r)
    const beta = rsNew / (rs || 1e-30)
    for (let i = 0; i < n; i++) p[i] = r[i] + beta * p[i]
    rs = rsNew
  }
  return x
}
