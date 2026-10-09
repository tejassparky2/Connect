import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Extends app.json. MOHALLA_TEST_BUILD=1 produces a sideloadable test build that may talk plain HTTP to an
 * API on the tester's LAN (Android blocks cleartext in release builds by default). Store builds never set it.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const testBuild = process.env.MOHALLA_TEST_BUILD === '1';
  return {
    ...(config as ExpoConfig),
    plugins: [...(config.plugins ?? []), ...(testBuild ? [['expo-build-properties', { android: { usesCleartextTraffic: true } }] as [string, unknown]] : [])],
  };
};
