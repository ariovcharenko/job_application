import Link from "next/link";
import FeedView from "@/components/feed/FeedView";
import { EmptyState } from "@/components/ui";
import { FEATURES } from "@/lib/features";

// While the Feed is hidden, FeedView never renders, so nothing on this page reads the database or
// calls JSearch (a search only ever starts from its "Search" button). The CSP also leaves JSearch
// out of connect-src, see next.config.js.
export default function FeedPage() {
  if (!FEATURES.jobFeed) {
    return (
      <EmptyState title="Job search is turned off for now">
        <Link href="/" className="font-medium text-accent hover:underline">
          Back to the tracker
        </Link>
      </EmptyState>
    );
  }
  return <FeedView />;
}
