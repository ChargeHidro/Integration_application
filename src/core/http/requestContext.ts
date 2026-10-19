import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import type { Logger } from "../logger";

const validRequestId = /^[A-Za-z0-9._-]{1,64}$/;

export function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get("x-request-id");
    const requestId = incoming && validRequestId.test(incoming) ? incoming : randomUUID();
    req.requestId = requestId;
    req.log = logger.child({ requestId });
    res.setHeader("x-request-id", requestId);
    next();
  };
}
