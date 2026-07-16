import { describe, expect, test } from "bun:test";
import { WRITE_TOOLS, toolApprovalFor, writeToolsEnabled } from "./permissions.ts";

describe("toolApprovalFor (fail-closed permission matrix)", () => {
  test("ask mode: every write tool needs user approval", () => {
    const approval = toolApprovalFor("ask");
    expect(approval.create_note).toBe("user-approval");
    expect(approval.update_note).toBe("user-approval");
    expect(approval.delete_note).toBe("user-approval");
  });

  test("accept-edits mode: creates/updates auto-approve, delete still asks", () => {
    const approval = toolApprovalFor("accept-edits");
    expect(approval.create_note).toBe("approved");
    expect(approval.update_note).toBe("approved");
    expect(approval.delete_note).toBe("user-approval"); // destructive: always confirm
  });

  test("read-only tools are never gated in any mode", () => {
    for (const mode of ["ask", "accept-edits", "readonly"] as const) {
      const approval = toolApprovalFor(mode);
      expect(approval.search_knowledge).toBeUndefined();
      expect(approval.read_note).toBeUndefined();
      expect(approval.list_notes).toBeUndefined();
      expect(approval.search_history).toBeUndefined();
    }
  });

  test("writeToolsEnabled: readonly mounts no write tools at all (fail-closed)", () => {
    expect(writeToolsEnabled("readonly")).toBe(false);
    expect(writeToolsEnabled("ask")).toBe(true);
    expect(writeToolsEnabled("accept-edits")).toBe(true);
  });

  test("WRITE_TOOLS names the full write surface", () => {
    expect(WRITE_TOOLS).toEqual(["create_note", "update_note", "delete_note"]);
  });
});
