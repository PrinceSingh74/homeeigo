/**
 * App entry — Sentry must initialise before expo-router loads any screen modules.
 */
import { initSentry } from "./src/lib/observability/sentry";

initSentry();

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("expo-router/entry");
