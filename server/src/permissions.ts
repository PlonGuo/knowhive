// Fail-closed permission matrix for agent write tools (Phase H).
// Maps the config's chat_permission_mode onto the AI SDK's toolApproval statuses:
//   'user-approval' → streamText pauses with a tool-approval-request chunk;
//   'approved'      → executes without asking;
//   readonly        → write tools are not mounted at all (stronger than 'denied').
// Deletion is destructive and always requires confirmation, even in accept-edits —
// same instinct as Claude Code's destructive-command warnings.

export type PermissionMode = "ask" | "accept-edits" | "readonly";

export const WRITE_TOOLS = ["create_note", "update_note", "delete_note"] as const;

type ApprovalStatus = "approved" | "user-approval";

export function writeToolsEnabled(mode: PermissionMode): boolean {
  return mode !== "readonly";
}

/** Per-tool approval config for streamText. Read-only tools are absent (ungated). */
export function toolApprovalFor(mode: PermissionMode): Record<string, ApprovalStatus> {
  if (mode === "readonly") return {};
  const edits: ApprovalStatus = mode === "accept-edits" ? "approved" : "user-approval";
  return {
    create_note: edits,
    update_note: edits,
    delete_note: "user-approval",
  };
}
