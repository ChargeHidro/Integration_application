import type { ErrorRequestHandler, RequestHandler } from "express";
import type { Logger } from "../logger";
import { AppError, NotFoundError } from "./errors";

export function notFoundHandler(): RequestHandler {
  return (req, _res, next) => next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
}

export function errorHandler(fallbackLogger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) return next(error);

    const log = req.log ?? fallbackLogger;
    const requestId = req.requestId;

    if (error instanceof AppError) {
      if (error.status >= 500) log.error({ err: error }, error.message);
      else log.warn({ code: error.code }, error.message);
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
          requestId,
        },
      });
      return;
    }

    if (isBodyParseError(error)) {
      log.warn("malformed JSON body");
      res.status(400).json({ error: { code: "validation_failed", message: "Malformed JSON body", requestId } });
      return;
    }

    log.error({ err: error }, "unhandled error");
    res.status(500).json({ error: { code: "internal_error", message: "Internal server error", requestId } });
  };
}

function isBodyParseError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "type" in error && error.type === "entity.parse.failed";
}
