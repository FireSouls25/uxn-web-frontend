import { describe, expect, it } from "vitest";
import { wsUrl } from "./live";

describe("live check", () => {
  it("maps the API base to a ws(s) URL with the token", () => {
    expect(wsUrl("http://localhost:8000")).toBe("ws://localhost:8000/ws/check");
    expect(wsUrl("https://api.example.com", "abc")).toBe("wss://api.example.com/ws/check?token=abc");
  });
});
