import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeShareCode, encodeShareCode, isShareCode, normalizeShareCode } from "./sharecode.js";

test("decodes and re-encodes a Valve share code", () => {
  const code = "CSGO-GADqf-jjyJ8-cSP2r-smZRo-TO2xK";
  const decoded = decodeShareCode(code);
  assert.equal(decoded.matchId, "6706677957664527113");
  assert.equal(decoded.outcomeId, "824291902840737810");
  assert.equal(decoded.token, 24400);
  assert.equal(encodeShareCode(decoded), code);
});

test("normalizes a share code without dashes", () => {
  const normalized = normalizeShareCode("GADqfjjyJ8cSP2rsmZRoTO2xK");
  assert.equal(normalized, "CSGO-GADqf-jjyJ8-cSP2r-smZRo-TO2xK");
  assert.equal(isShareCode(normalized), true);
});

test("rejects malformed codes", () => {
  assert.equal(isShareCode("CSGO-AAAAA-AAAAA-AAAAA-AAAAA"), false);
  assert.throws(() => decodeShareCode("not-a-code"));
});
