import { describe, expect, it } from "vitest";
import { redactString, redactUnknown } from "../src/shared/redaction.js";

describe("redaction", () => {
  it("redacts API keys in strings", () => {
    const result = redactString("value sk_test_secret_123 more");
    expect(result).not.toContain("sk_test_secret_123");
    expect(result).toContain("***REDACTED***");
  });

  it("redacts ClickUp tokens", () => {
    const result = redactString("clickup_token_secret");
    expect(result).toContain("***REDACTED***");
    expect(result).not.toContain("token_secret");
  });

  it("redacts nested structures", () => {
    const value = {
      apiKey: "sk_live_secret_999",
      details: {
        clickupToken: "clickup_prod_123",
        plain: "safe"
      }
    };
    const result = redactUnknown(value) as Record<string, unknown>;
    expect(result.apiKey).toBe("***REDACTED***");
    const details = result.details as Record<string, unknown>;
    expect(details.clickupToken).toBe("***REDACTED***");
    expect(details.plain).toBe("safe");
  });
});
