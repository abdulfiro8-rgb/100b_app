import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.milestamp.app",
  appName: "Milestamp",
  webDir: "dist",
  // No server.url: the app must run entirely from bundled assets. A wrapper that
  // loads a remote site is both a privacy contradiction and a guideline 4.2
  // rejection waiting to happen.
  ios: {
    contentInset: "always",
  },
  android: {
    // Trip detection has to survive the app being backgrounded, which is the
    // entire point — see docs/mobile.md for the foreground-service requirements.
    allowMixedContent: false,
  },
};

export default config;
