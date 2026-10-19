import type { Request, RequestHandler } from "express";
import { UnauthorizedError } from "../errors/errors";
import type { Caller } from "./caller";
import { verifyToken, type TokenSettings } from "./tokens";

const bearerPattern = /^Bearer\s+(\S+)$/i;

export function authenticate(settings: TokenSettings): RequestHandler {
  return (req, _res, next) => {
    const token = bearerPattern.exec(req.get("authorization") ?? "")?.[1];
    if (!token) return next(new UnauthorizedError("Missing bearer token"));

    verifyToken(token, settings).then((caller) => {
      req.caller = caller;
      next();
    }, next);
  };
}

export function callerOf(req: Request): Caller {
  if (!req.caller) throw new UnauthorizedError();
  return req.caller;
}
