import { useEffect, useState } from "react";
import { z } from "zod";

export const REVIEW_MODE = import.meta.env.VITE_REVIEW_MODE === "true";
const configSchema = z.object({
  environment: z.literal("temporary-human-review"),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  implementation_baseline: z.string().regex(/^[a-f0-9]{40}$/),
  approval: z.literal("PENDING_HUMAN_REVIEW"),
  isolated_runner: z.literal(false),
  accounting_status: z.string(),
});

export function ReviewNotice() {
  const [config, setConfig] = useState<z.infer<typeof configSchema>>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/review/config", {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return configSchema.parse(await response.json());
      })
      .then(setConfig)
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Unavailable");
      });
    return () => controller.abort();
  }, []);
  return (
    <section className="review-notice" aria-label="Human review deployment">
      <strong>Temporary human review · Approval pending</strong>
      <p>
        Shared disposable data. Guild switching is not authentication. This site
        gathers feedback before the baseline is frozen for AI-agent experiments.
      </p>
      {config && (
        <>
          <p>
            Deployed commit: <code>{config.commit}</code>
            <br />
            Wallet repair commit: <code>{config.implementation_baseline}</code>
          </p>
          <p>
            <strong>Wallet accounting:</strong> {config.accounting_status}.
          </p>
          <a
            href={`https://github.com/houtanrocky/dragon-market/issues/new?template=human-review.yml&title=${encodeURIComponent(`[Human review ${config.commit.slice(0, 8)}] `)}`}
            target="_blank"
            rel="noreferrer"
          >
            Submit a reproducible review finding
          </a>
        </>
      )}
      {error && (
        <p role="alert">
          Deployment identity unavailable: {error}. Do not approve an
          unidentified deployment.
        </p>
      )}
      <p className="caption">
        Free hosting can sleep. Auction settlement may be delayed while asleep;
        timing observations here are not experiment measurements.
      </p>
    </section>
  );
}
