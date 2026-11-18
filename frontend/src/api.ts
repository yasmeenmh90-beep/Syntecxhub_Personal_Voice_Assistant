export type Settings = {
  voice: string;
  rate: number;
  microphone: string;
  voice_response: boolean;
  theme: "dark" | "light";
};
export type Result = {
  status: "completed" | "error" | "confirmation_required";
  message: string;
  ended: boolean;
  action: { type: string; target: string } | null;
};
export const defaults: Settings = {
  voice: "",
  rate: 1,
  microphone: "",
  voice_response: true,
  theme: "dark",
};
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/" + path, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
      signal: options?.signal ?? AbortSignal.timeout(20000),
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      ["AbortError", "TimeoutError"].includes(error.name)
    )
      throw new Error(
        "The request timed out. Check the backend connection and try again.",
      );
    if (error instanceof TypeError)
      throw new Error(
        "Backend connection failed. Check that Python is running on localhost:8000.",
      );
    throw error;
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Backend returned an unreadable response (HTTP ${response.status}). Check the Python terminal.`,
    );
  }
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "Invalid request. Check settings and try again.",
    );
  return data;
}
