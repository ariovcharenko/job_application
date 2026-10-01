import { describe, expect, it } from "vitest";
import { bulletScore, hasRealMetric, metricsIn } from "./relevance";

describe("metricsIn", () => {
  it("finds quantities with their unit or marker", () => {
    expect(metricsIn("Shipped **6 production features** for **80+ early users**")).toEqual(["6", "80+"]);
    expect(metricsIn("Cut latency **~35%** to **p95 ~250-450 ms** with **>99% uptime**")).toEqual(["~35%", "~250", ">99%"]);
    expect(metricsIn("Saved **$2M** a year, **3x** faster, **10k** requests in **2 weeks**")).toEqual(["$2M", "3x", "10k", "2 weeks"]);
    expect(metricsIn("Led a team of 4 engineers")).toEqual(["4"]);
  });

  it("ignores names and versions that contain digits", () => {
    for (const text of [
      "Stored uploads in **AWS S3** and load-tested with **k6**",
      "Tracked **p95** latency on **EC2**",
      "Built a **Java 17** backend with **Spring Boot 3**",
      "Migrated to **React 18** and **Next.js 14** on **Python 3.11**",
      "Served assets over HTTP/2 with 2FA and 3D previews",
      "Graduated in 2024",
    ]) {
      expect(hasRealMetric(text), text).toBe(false);
    }
  });
});

describe("bulletScore", () => {
  it("ranks a job-skill bullet low in the list above a metric-free one higher up", () => {
    const hitsJest = (t: string) => (/Jest/.test(t) ? 1 : 0);
    const early = bulletScore("Refactored the settings page", 1, 5, hitsJest);
    const jest = bulletScore("Wrote **Jest** unit and component tests", 4, 5, hitsJest);
    expect(jest).toBeGreaterThan(early);
  });

  it("gives a real metric credit but not an S3/k6 token", () => {
    expect(bulletScore("Shipped **6 production features**", 2, 3)).toBeGreaterThan(bulletScore("Used **S3** and **k6**", 2, 3));
  });

  it("follows the model's order when nothing else differs", () => {
    expect(bulletScore("a", 0, 3)).toBeGreaterThan(bulletScore("b", 1, 3));
    expect(bulletScore("b", 1, 3)).toBeGreaterThan(bulletScore("c", 2, 3));
  });
});
