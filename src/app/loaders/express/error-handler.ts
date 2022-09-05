import { errors, isCelebrateError } from 'celebrate'
import { ErrorRequestHandler, RequestHandler } from 'express'
import { HttpError, isHttpError } from 'http-errors'
import { StatusCodes } from 'http-status-codes'
import get from 'lodash/get'

import { createLoggerWithLabel } from '../../config/logger'

const logger = createLoggerWithLabel(module)
const celebrateErrorHandler = errors()

const isBodyParserError = (
  err: unknown,
): err is HttpError & { type: string } => {
  return isHttpError(err) && 'type' in err
}

const errorHandlerMiddlewares = (): (
  | ErrorRequestHandler
  | RequestHandler
)[] => {
  // Assume 'not found' in the error msgs is a 404. this is somewhat silly, but valid, you can do whatever you like, set properties, use instanceof etc.
  const genericErrorHandlerMiddleware: ErrorRequestHandler = function (
    err,
    req,
    res,
    next,
  ) {
    // If headers have already been sent, don't send again
    if (res.headersSent) {
      return
    }

    // If the error object doesn't exists
    if (!err) {
      return next()
    } else {
      const genericErrorMessage =
        'Apologies, something odd happened. Please try again later!'
      // Error page
      if (isCelebrateError(err)) {
        logger.error({
          message: 'Joi validation error',
          meta: {
            action: 'genericErrorHandlerMiddleware',
            // formId is only present for Joi validated routes that require it
            formId: get(req, 'form._id', null),
            details: Object.fromEntries(err.details),
          },
          error: err,
        })
        return celebrateErrorHandler(err, req, res, next)
      }

      if (isBodyParserError(err)) {
        logger.error({
          message: 'Body parser error',
          meta: {
            action: 'genericErrorHandlerMiddleware',
            // formId is only present for Joi validated routes that require it
            formId: get(req, 'form._id', null),
            details: {
              type: err.type,
              message: err.message,
            },
          },
          error: err,
        })
        if (err.expose) {
          return res
            .status(err.status)
            .json({ message: err.message ?? genericErrorMessage })
        }
        return res.status(err.status).json({ message: genericErrorMessage })
      }

      // Unknown errors
      logger.error({
        message: 'Unknown error',
        meta: {
          action: 'genericErrorHandlerMiddleware',
        },
        error: err,
      })
      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ message: genericErrorMessage })
    }
  }

  // Assume 404 since no middleware responded
  const catchNonExistentRoutesMiddleware: RequestHandler = function (
    _req,
    res,
  ) {
    res.sendStatus(StatusCodes.NOT_FOUND)
  }

  return [genericErrorHandlerMiddleware, catchNonExistentRoutesMiddleware]
}

export default errorHandlerMiddlewares
