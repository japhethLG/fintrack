/**
 * Public surface of the UI test harness. Specs import from here:
 *
 *   import { renderApp, screen, within, waitFor, knownDefect, moneyNear } from "../harness";
 */
export {
  renderApp,
  preloadApp,
  seedStore,
  resolveNow,
  APP_ROUTES,
  DEFAULT_TODAY,
} from "./renderApp";
export type { AppHandle, AppSeed, RenderAppOptions } from "./renderApp";
export { knownDefect, FLIP } from "./knownDefect";
export { parseMoney, moneyValues, moneyNear, moneyIn, moneyInRow, spacedText } from "./money";
export { consoleCalls, allowConsole } from "./consoleCapture";
export { blockedRequests } from "./networkGuard";
export { makeFakeUser } from "./authFake";
export {
  screen,
  within,
  waitFor,
  waitForElementToBeRemoved,
  act,
  fireEvent,
} from "@testing-library/react";
export * from "../../helpers/builders";
