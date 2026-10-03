import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

type TaskManagerModule = typeof import("expo-task-manager");

let cached: TaskManagerModule | null | undefined;

/**
 * expo-task-manager, or null when this binary does not contain its native module (Expo Go, web, or
 * a dev build made before the dependency was added). Importing the package directly would throw at
 * module load in those binaries and crash the app on launch — so it is only required after the
 * native module is known to exist.
 */
export function loadTaskManager(): TaskManagerModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS === "web" || !requireOptionalNativeModule("ExpoTaskManager")) {
    cached = null;
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require("expo-task-manager") as TaskManagerModule;
  } catch {
    cached = null;
  }
  return cached;
}
