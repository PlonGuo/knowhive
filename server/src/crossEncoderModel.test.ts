import { expect, test } from "bun:test";
import { getModelCacheDir, setModelCacheDir } from "./crossEncoderModel.ts";

// The .app resources dir is read-only; transformers.js must cache models under the
// app data dir. The setter is wired from index.ts startup (dataDir/models).

test("model cache dir is unset until configured", () => {
  expect(getModelCacheDir()).toBeNull();
});

test("setModelCacheDir stores the directory used for model downloads", () => {
  setModelCacheDir("/data/models");
  expect(getModelCacheDir()).toBe("/data/models");
});
