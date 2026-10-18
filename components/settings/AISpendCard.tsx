"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { formatUsd, monthStart, summarize } from "@/lib/ai/usage";
import { Card } from "@/components/ui";

/**
 * What AI calls cost this month, worked out in this browser from the tokens each response
 * reported and list prices (lib/ai/prices.ts). Nothing here is sent anywhere.
 */
export default function AISpendCard() {
  const month = useLiveQuery(async () => summarize(await db.aiUsage.where("at").aboveOrEqual(monthStart()).toArray()), []);
  const monthName = new Date().toLocaleDateString(undefined, { month: "long" });

  return (
    <Card
      title="AI spend"
      hint="Worked out in this browser from the tokens each answer used and list prices. Your provider's bill is the exact figure."
    >
      {!month ? null : (
        <>
          <p className="text-[15px] text-muted">AI spend this month</p>
          <p className="mt-1 text-[34px] font-semibold leading-tight tracking-display text-ink">
            {formatUsd(month.usd)}
            {month.estimated && <span className="ml-2 align-middle text-[13px] font-medium text-muted">estimate</span>}
          </p>
          {month.calls === 0 ? (
            <p className="mt-2 text-sm text-muted">No AI calls yet in {monthName}.</p>
          ) : (
            <ul className="mt-4 divide-y divide-black/[0.06] text-sm">
              {month.byTask.map((t) => (
                <li key={t.task} className="flex items-baseline justify-between gap-3 py-2">
                  <span>
                    {t.label}
                    <span className="ml-2 text-muted">
                      {t.calls} call{t.calls === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatUsd(t.usd)}</span>
                </li>
              ))}
            </ul>
          )}
          {month.estimated && (
            <p className="mt-3 text-[13px] text-muted">Some calls used a model whose price isn&apos;t listed here, so a high price was assumed for them.</p>
          )}
        </>
      )}
    </Card>
  );
}
