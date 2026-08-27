import type { INestApplication } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { HttpExceptionEnvelopeFilter } from "./http-exception-envelope.filter.js";
import { createRequestContextMiddleware, REQUEST_ID_HEADER, type RequestLogWriter } from "./request-context.js";

export interface HttpBoundaryOptions {
  requestLogWriter?: RequestLogWriter;
}

export function configureHttpBoundary(app: INestApplication, options: HttpBoundaryOptions = {}) {
  app.use(createRequestContextMiddleware({ logWriter: options.requestLogWriter }));
  app.useGlobalFilters(new HttpExceptionEnvelopeFilter(app.get(HttpAdapterHost)));
  return app;
}

export { REQUEST_ID_HEADER };
export type { RequestCompletionLog, RequestLogWriter } from "./request-context.js";
