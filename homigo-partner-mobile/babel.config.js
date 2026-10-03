module.exports = function (api) {
  api.cache(true);
  return {
    // Expo SDK 54 / Reanimated 4: babel-preset-expo configures worklets/reanimated.
    // Do NOT add react-native-reanimated/plugin manually — it races native Expo
    // bootstrap and surfaces as [runtime not ready] EventEmitter of undefined.
    presets: ["babel-preset-expo"],
  };
};
