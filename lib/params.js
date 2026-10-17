import { ProblemDetailsError } from './errors/problemdetailserror.js'

export function pageNumber (req, res, next, value, name) {
  if (!value.match(/^[1-9][0-9]*$/)) {
    return next(new ProblemDetailsError(400, 'invalid page number'))
  }
  let n
  try {
    n = parseInt(value)
  } catch (err) {
    return next(new ProblemDetailsError(400, 'invalid page number'))
  }
  if (!Number.isSafeInteger(n)) {
    return next(new ProblemDetailsError(400, 'invalid page number'))
  }
  req.params[name] = n
  next()
}
