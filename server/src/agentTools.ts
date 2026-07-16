// Read-only agent tools for the /chat agentic loop (Phase G). Pure logic with
// injected deps so the tool behaviors are unit-testable without a model, DB, or
// filesystem. Design constraints (see docs/plans/2026-07-13-phase-g-agentic-loop.md):
//   - k is fixed, not model-controlled — smaller schema = higher valid-call rate on 3B models
//   - tool failures return {error} values instead of throwing — a throw becomes a
//     tool-output-error chunk and derails small models; an error value lets them recover
//   - outputs are compact (three fields per chunk) to keep multi-step context small
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ChunkRow } from "./store.ts";

export const AGENT_SEARCH_K = 5;
export const READ_NOTE_MAX_CHARS = 6000;
export const LIST_NOTES_MAX = 200;

/** Per-request accumulator of source file paths (deduped, insertion-ordered).
 * Tools collect into it as they execute; /chat snapshots it into messageMetadata. */
export class SourceCollector {
  private seen = new Set<string>();
  private order: string[] = [];

  add(...paths: string[]): void {
    for (const p of paths) {
      if (!this.seen.has(p)) {
        this.seen.add(p);
        this.order.push(p);
      }
    }
  }

  list(): string[] {
    return [...this.order];
  }
}

export interface AgentToolDeps {
  retrieve: (query: string, k: number) => Promise<ChunkRow[]>;
  /** Read a note by knowledge-dir-relative path. Throws SafePathError / not-found. */
  readNote: (relPath: string) => { path: string; content: string };
  listNotePaths: () => string[];
  sources: SourceCollector;
  /** Episodic search over past conversations (session mode only, Phase M3). */
  searchHistory?: (query: string) => { question: string; answer: string; when: string }[];
  /** Note write operations (Phase H). Absent = readonly mode: tools not mounted.
   * Approval gating happens at the streamText layer (toolApprovalFor), not here. */
  writeNotes?: {
    create: (relPath: string, content: string) => Promise<{ path: string; bytes: number }>;
    update: (relPath: string, content: string) => Promise<{ path: string; bytes: number }>;
    remove: (relPath: string) => Promise<{ path: string }>;
  };
}

const errorValue = (err: unknown) => ({ error: (err as Error).message });

export function buildAgentTools(deps: AgentToolDeps): ToolSet {
  return {
    search_knowledge: tool({
      description:
        "Search the knowledge base for notes about a topic. Returns the most relevant excerpts with their file paths.",
      inputSchema: z.object({ query: z.string().describe("focused search query") }),
      execute: async ({ query }) => {
        try {
          const chunks = await deps.retrieve(query, AGENT_SEARCH_K);
          deps.sources.add(...chunks.map((c) => c.file_path));
          return {
            results: chunks.map((c) => ({
              file_path: c.file_path,
              section: c.section_heading,
              content: c.content,
            })),
          };
        } catch (err) {
          return errorValue(err);
        }
      },
    }),

    read_note: tool({
      description:
        "Read the full content of one note when search excerpts are not enough. Use the exact file_path from search results or list_notes.",
      inputSchema: z.object({ path: z.string().describe("note path relative to the knowledge base") }),
      execute: async ({ path }) => {
        try {
          const note = deps.readNote(path);
          deps.sources.add(note.path);
          const content =
            note.content.length > READ_NOTE_MAX_CHARS
              ? `${note.content.slice(0, READ_NOTE_MAX_CHARS)}\n[truncated]`
              : note.content;
          return { path: note.path, content };
        } catch (err) {
          return errorValue(err);
        }
      },
    }),

    list_notes: tool({
      description: "List all note paths in the knowledge base.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const all = deps.listNotePaths();
          return all.length > LIST_NOTES_MAX
            ? { paths: all.slice(0, LIST_NOTES_MAX), truncated: true }
            : { paths: all };
        } catch (err) {
          return errorValue(err);
        }
      },
    }),

    ...(deps.writeNotes
      ? {
          create_note: tool({
            description:
              "Create a new markdown note in the knowledge base. Fails if the path already exists.",
            inputSchema: z.object({
              path: z.string().describe("new note path relative to the knowledge base, e.g. ideas/plan.md"),
              content: z.string().describe("markdown content"),
            }),
            execute: async ({ path, content }) => {
              try {
                const r = await deps.writeNotes!.create(path, content);
                deps.sources.add(r.path);
                return { ...r, status: "created" };
              } catch (err) {
                return errorValue(err);
              }
            },
          }),
          update_note: tool({
            description: "Replace the full content of an existing note.",
            inputSchema: z.object({
              path: z.string().describe("existing note path"),
              content: z.string().describe("new markdown content (full replacement)"),
            }),
            execute: async ({ path, content }) => {
              try {
                const r = await deps.writeNotes!.update(path, content);
                deps.sources.add(r.path);
                return { ...r, status: "updated" };
              } catch (err) {
                return errorValue(err);
              }
            },
          }),
          delete_note: tool({
            description: "Permanently delete a note from the knowledge base.",
            inputSchema: z.object({ path: z.string().describe("note path to delete") }),
            execute: async ({ path }) => {
              try {
                const r = await deps.writeNotes!.remove(path);
                return { ...r, status: "deleted" };
              } catch (err) {
                return errorValue(err);
              }
            },
          }),
        }
      : {}),

    ...(deps.searchHistory
      ? {
          search_history: tool({
            description:
              "Search past conversations with this user. Use when the question refers to something discussed before.",
            inputSchema: z.object({ query: z.string().describe("keyword to search for") }),
            execute: async ({ query }) => {
              try {
                return { results: deps.searchHistory!(query) };
              } catch (err) {
                return errorValue(err);
              }
            },
          }),
        }
      : {}),
  };
}
