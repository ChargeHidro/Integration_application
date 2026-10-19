import type { RequestHandler } from "express";

export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      req.log.info(
        {
          method: req.method,
          path: req.originalUrl.split("?")[0],
          status: res.statusCode,
          durationMs: Number(process.hrtime.bigint() - started) / 1e6,
        },
        "request completed",
      );
    });
    next();
  };
}
