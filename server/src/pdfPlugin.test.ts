import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { PdfPluginSession, parsePdfs, pluginInfo } from "./pdfPlugin.ts";

// The fake plugin speaks the real stdio protocol without needing docling:
// paths containing "scan"/"broken" come back as triage errors, others succeed.
const FAKE = join(import.meta.dir, "..", "test-fixtures", "fake-knowhive-pdf.sh");
const OLD_SCHEMA = join(import.meta.dir, "..", "test-fixtures", "fake-knowhive-pdf-oldschema.sh");

describe("pluginInfo", () => {
  test("reports handshake fields when the plugin responds", async () => {
    const info = await pluginInfo(FAKE);
    expect(info.installed).toBe(true);
    expect(info.schema_version).toBe(1);
    expect(info.plugin_version).toBe("9.9.9-fake");
  });

  test("reports installed:false when the binary is missing", async () => {
    const info = await pluginInfo("/nonexistent/knowhive-pdf");
    expect(info.installed).toBe(false);
  });
});

describe("parsePdfs", () => {
  test("maps each path to a result or a coded error, in order", async () => {
    const out = await parsePdfs(["/tmp/a.pdf", "/tmp/scan.pdf", "/tmp/broken.pdf"], { bin: FAKE });
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ path: "/tmp/a.pdf", ir: { format: "pdf" } });
    expect((out[0] as { ir: { blocks: unknown[] } }).ir.blocks.length).toBeGreaterThan(0);
    expect(out[1]).toMatchObject({ path: "/tmp/scan.pdf", code: "needs_ocr" });
    expect(out[2]).toMatchObject({ path: "/tmp/broken.pdf", code: "bad_text_layer" });
  });

  test("rejects a plugin with an unknown schema version", async () => {
    await expect(parsePdfs(["/tmp/a.pdf"], { bin: OLD_SCHEMA })).rejects.toThrow(/schema/i);
  });

  test("rejects when the plugin binary is missing", async () => {
    await expect(parsePdfs(["/tmp/a.pdf"], { bin: "/nonexistent/knowhive-pdf" })).rejects.toThrow();
  });
});

describe("PdfPluginSession", () => {
  test("parses files one at a time over a single live process", async () => {
    const session = new PdfPluginSession(FAKE);
    try {
      const a = await session.parseOne("/tmp/a.pdf");
      const scan = await session.parseOne("/tmp/scan.pdf");
      const b = await session.parseOne("/tmp/b.pdf");
      expect(a).toMatchObject({ path: "/tmp/a.pdf", ir: { format: "pdf" } });
      expect(scan).toMatchObject({ code: "needs_ocr" });
      expect(b).toMatchObject({ path: "/tmp/b.pdf", ir: { format: "pdf" } });
    } finally {
      session.close();
    }
  });

  test("interleaved calls serialize correctly", async () => {
    const session = new PdfPluginSession(FAKE);
    try {
      const [a, b, c] = await Promise.all([
        session.parseOne("/tmp/one.pdf"),
        session.parseOne("/tmp/scan.pdf"),
        session.parseOne("/tmp/three.pdf"),
      ]);
      expect(a!.path).toBe("/tmp/one.pdf");
      expect(b).toMatchObject({ path: "/tmp/scan.pdf", code: "needs_ocr" });
      expect(c!.path).toBe("/tmp/three.pdf");
    } finally {
      session.close();
    }
  });
});
