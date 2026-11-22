import { test } from "node:test";
import assert from "node:assert/strict";
import { metrics, metricById, registryVersion } from "./registry.js";

test("registry contains 538 unique metrics", () => {
  assert.equal(metrics.length, 538);
  assert.equal(metricById.size, 538);
});

test("every metric has the fields required by the tooltip contract", () => {
  for (const metric of metrics) {
    assert.match(metric.id, /^[A-Z]{3}-\d{3}$/);
    assert.ok(metric.name.length > 2, `${metric.id} name`);
    assert.ok(metric.unit.length > 0, `${metric.id} unit`);
    assert.ok(metric.formula.length > 0, `${metric.id} formula`);
    assert.ok(metric.tooltip.length > 10, `${metric.id} tooltip`);
    assert.ok(metric.minSample > 0, `${metric.id} minSample`);
    assert.ok(metric.sources.length > 0, `${metric.id} sources`);
  }
});

test("registry version is exposed", () => {
  assert.match(registryVersion, /^\d+\.\d+\./);
});
