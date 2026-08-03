import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.fieldproof.app",
  appName: "Fieldproof",
  webDir: "dist",
  // No server.url. The app runs entirely from bundled assets: a wrapper that
  // loaded a remote page would contradict the on-device evidence claim and
  // invites a guideline 4.2 rejection.
  ios: {
    contentInset: "always",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    Camera: {
      // Permission strings are declared in the native projects:
      //   iOS   — NSCameraUsageDescription, NSPhotoLibraryUsageDescription,
      //           NSLocationWhenInUseUsageDescription
      //   Android — CAMERA, ACCESS_FINE_LOCATION
      //
      // Note this app needs location only *while in use*. Unlike Milestamp it
      // never tracks in the background, so there is no ACCESS_BACKGROUND_LOCATION
      // declaration and no Play Console justification video — a markedly easier
      // review than the mileage tracker faces.
    },
  },
};

export default config;
