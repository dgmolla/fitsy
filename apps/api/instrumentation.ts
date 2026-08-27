/**
 * Next.js instrumentation — onRequestError fires for every uncaught error in
 * route handlers and server components, our one central hook for "a request
 * 500'd in prod". Alerts Slack via reportServerError (deduped, fire-and-forget).
 *
 * Handled errors that return a 500 response never reach this hook; routes that
 * catch-and-respond should call reportServerError themselves when the failure
 * is alert-worthy.
 */
import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
) => {
  const { reportServerError } = await import("@/lib/errorAlert");
  reportServerError(`${request.method} ${request.path}`, err);
};
