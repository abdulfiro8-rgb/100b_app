import { Camera, CameraResultType, CameraSource as CapCameraSource } from "@capacitor/camera";
import { Geolocation } from "@capacitor/geolocation";
import type { FixedLocation } from "../core/types.js";
import type { CameraSource, CapturedImage, LocationSource } from "./types.js";

/**
 * Real capture on a device.
 *
 * Implements the same interfaces as `mock.ts`, so nothing downstream changes —
 * the evidence chain, provenance checks and reporting cannot tell the
 * difference, which is what let all of that be tested before this file existed.
 */

export class DeviceCamera implements CameraSource {
  readonly name = "capacitor";

  async capture(): Promise<CapturedImage> {
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.Base64,
      source: CapCameraSource.Camera,
      // Never let the OS gallery substitute for the camera: the distinction
      // between a live capture and an imported file is recorded as evidence,
      // and a prompt that blurs the two would make the record dishonest.
      allowEditing: false,
      quality: 88,
      correctOrientation: true,
      saveToGallery: false,
    });

    return {
      bytes: decodeBase64(photo.base64String ?? ""),
      mimeType: photo.format === "png" ? "image/png" : "image/jpeg",
      source: "camera",
    };
  }

  async pickFromLibrary(): Promise<CapturedImage> {
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.Base64,
      source: CapCameraSource.Photos,
      allowEditing: false,
      correctOrientation: true,
    });

    return {
      bytes: decodeBase64(photo.base64String ?? ""),
      mimeType: photo.format === "png" ? "image/png" : "image/jpeg",
      source: "library",
    };
  }
}

export class DeviceLocation implements LocationSource {
  constructor(private readonly timeoutMs = 8_000) {}

  async current(): Promise<FixedLocation | undefined> {
    try {
      const permission = await Geolocation.checkPermissions();
      if (permission.location === "denied") return undefined;

      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        // A capture must not stall behind a slow fix. An inspector in a
        // basement still needs to photograph the damage; the missing location
        // is reported as a provenance note rather than blocking the work.
        timeout: this.timeoutMs,
        maximumAge: 30_000,
      });

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMetres: position.coords.accuracy,
      };
    } catch {
      return undefined;
    }
  }
}

/** Requests the permissions capture needs. Safe to call more than once. */
export async function requestCapturePermissions(): Promise<{
  camera: boolean;
  location: boolean;
}> {
  const [camera, location] = await Promise.allSettled([
    Camera.requestPermissions({ permissions: ["camera"] }),
    Geolocation.requestPermissions(),
  ]);

  return {
    camera: camera.status === "fulfilled" && camera.value.camera === "granted",
    location:
      location.status === "fulfilled" &&
      (location.value.location === "granted" || location.value.location === "prompt"),
  };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
