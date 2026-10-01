/**
 * @pickem/contracts — versioned API contracts for the NFL pick'em platform.
 *
 * v1 is the current contract version. Future versions live alongside it
 * (e.g. `src/v2/`) so the web app and the React Native client can migrate
 * route by route without a flag day.
 */
export * as v1 from "./v1/index.js";
export { ROUTES_V1, AUTH_GATED_PATHS } from "./v1/routes.js";
