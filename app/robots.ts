import type { MetadataRoute } from "next";

// Every visitor's data lives in their own browser, so no page holds anything personal on the
// server. The landing page, the example and the privacy page are worth indexing; the app screens
// (a stranger's empty tracker, settings) aren't useful search results.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/settings", "/resumes", "/onboarding", "/feed"],
      },
    ],
  };
}
