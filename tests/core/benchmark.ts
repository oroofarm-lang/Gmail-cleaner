import { performance } from "node:perf_hooks";
import { createDemoMessages, aggregate } from "../../packages/core/index.ts";
for (const count of [10000, 50000, 100000]) {
  const start = performance.now();
  const messages = createDemoMessages(count);
  const generated = performance.now();
  const report = aggregate(messages);
  const end = performance.now();
  console.log(
    JSON.stringify({
      count,
      generationMs: Math.round(generated - start),
      aggregationMs: Math.round(end - generated),
      heapMiB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      candidates: report.candidates,
      protected: report.protected,
      review: report.review,
    }),
  );
  if (
    report.total !== count ||
    report.candidates + report.protected + report.review !== count
  )
    throw new Error("Scale invariant failed");
}
