import type { Logger } from "pino";
import type { Caller } from "../auth/caller";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: Logger;
      caller?: Caller;
    }
  }
}

export {};
