// Gateway commands are sent as JSON strings. Fail loudly if a test reads a different body shape.
export function requestBody(init?: RequestInit): string {
  if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");

  return init.body;
}
