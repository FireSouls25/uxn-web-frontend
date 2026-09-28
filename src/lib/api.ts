/* Backend client. Base URL is build-time config; every call
   degrades to static fallbacks so pages render with no backend. */

export const API_URL =
  (import.meta.env.PUBLIC_API_URL as string | undefined) ?? "http://localhost:8000";

export interface TargetInfo {
  id: string;
  etal_target: string;
  kind: string;
  vendored: boolean | null;
}

export interface TargetsResponse {
  supported: TargetInfo[];
  coming_soon: TargetInfo[];
}

export const FALLBACK_TARGETS: TargetsResponse = {
  supported: [
    { id: "linux", etal_target: "linux-x86_64", kind: "sh+tar.gz", vendored: true },
    { id: "web", etal_target: "web", kind: "uxn5 html", vendored: true },
  ],
  coming_soon: [
    { id: "macos-arm64", etal_target: "macos-arm64", kind: "sh+tar.gz", vendored: true },
    { id: "macos-x86_64", etal_target: "macos-x86_64", kind: "sh+tar.gz", vendored: false },
    { id: "linux-aarch64", etal_target: "linux-aarch64", kind: "sh+tar.gz", vendored: false },
    { id: "windows-x86_64", etal_target: "windows-x86_64", kind: "zip", vendored: false },
  ],
};

export async function fetchTargets(signal?: AbortSignal): Promise<TargetsResponse> {
  const res = await fetch(`${API_URL}/targets`, { signal });
  if (!res.ok) throw new Error(`targets: ${res.status}`);
  return (await res.json()) as TargetsResponse;
}
