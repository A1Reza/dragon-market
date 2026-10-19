import { useState } from "react";
import { ArrowRight, Check, FlaskConical, Play, Shield } from "lucide-react";
import { APIError, newKey } from "./api";
import type {
  Auction,
  Bid,
  Item,
  Mutation,
  Snapshot,
  Trace,
} from "./contracts";
import { Badge, Json } from "./components";
import { REVIEW_MODE } from "./review";

type Fixture = {
  seller: string;
  buyer: string;
  bidder: string;
  item: Item;
  order?: string;
  auction?: Auction;
  key: string;
  first?: Bid;
  second?: Bid;
};
type Report = {
  scenario: string;
  status: string;
  command: string;
  output: string;
  report?: unknown;
  environment: string;
};
export function ResearchLab({
  run,
  data,
  selectGuild,
}: {
  run: (m: Mutation) => Promise<Trace>;
  data?: Snapshot;
  selectGuild: (id: string) => void;
}) {
  const [scenario, setScenario] = useState("purchase");
  const [fixture, setFixture] = useState<Fixture>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<unknown>();
  const [report, setReport] = useState<Report>();
  const [purchased, setPurchased] = useState(false);
  const [firstTrace, setFirstTrace] = useState<Trace>();
  const scenarios = [
    [
      "purchase",
      "A",
      "Normal purchase",
      "Follow payment and ownership together.",
    ],
    [
      "retry",
      "B",
      "Idempotent retry",
      "One logical operation. The same request key.",
    ],
    [
      "competing-buyers",
      "C",
      "Competing buyers",
      "A synchronized Go driver, independently checked.",
    ],
    [
      "bidding",
      "D",
      "Auction bidding",
      "Reserve, outbid, release, and inspect.",
    ],
    [
      "cancellation",
      "E",
      "Bid cancellation",
      "Valid release and expected rejection.",
    ],
    [
      "rollback",
      "F",
      "Failure & rollback",
      "A deterministic late failure in an isolated fixture.",
    ],
    [
      "settlement",
      "G",
      "Auction settlement",
      "Controlled time, real settlement worker.",
    ],
  ];
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function prepare(auction = false) {
    const prefix = `lab-${newKey().slice(0, 8)}`;
    const guilds = {
      seller: prefix + "-seller",
      buyer: prefix + "-buyer",
      bidder: prefix + "-bidder",
    };
    for (const id of Object.values(guilds))
      await run({
        method: "POST",
        path: "/guilds",
        body: { id, gold: 10000, daily_limit: 5000 },
        actor: id,
        label: "Lab: create isolated guild",
      });
    const itemTrace = await run({
      method: "POST",
      path: "/items",
      body: {
        name: auction ? "Lab · Crown of embers" : "Lab · Emberglass blade",
        type: auction ? "legendary" : "rare",
        owner_id: guilds.seller,
        base_price: 100,
      },
      actor: guilds.seller,
      label: "Lab: create artifact",
    });
    const item = itemTrace.reply!.data as Item;
    const created = await run({
      method: "POST",
      path: auction ? "/auctions" : "/orders",
      body: auction
        ? { item_id: item.id, seller_id: guilds.seller, base_price: 100 }
        : { item_id: item.id, owner_id: guilds.seller, base_price: 100 },
      actor: guilds.seller,
      label: auction ? "Lab: start auction" : "Lab: create listing",
      target: item.id,
    });
    setFixture({
      ...guilds,
      item,
      key: newKey(),
      order: auction ? undefined : (created.reply!.data as { id: string }).id,
      auction: auction ? (created.reply!.data as Auction) : undefined,
    });
    setPurchased(false);
    setFirstTrace(undefined);
    setResult({
      observation:
        "Fixture created through real endpoints. Unique data in the active development database; no existing rows reset.",
      reply: created.reply,
      initial: created.after,
    });
    selectGuild(guilds.buyer);
  }
  async function purchase() {
    if (!fixture) return;
    const trace = await run({
      method: "POST",
      path: `/orders/${fixture.order}/buy`,
      body: { buyer_id: fixture.buyer },
      actor: fixture.buyer,
      key: fixture.key,
      label: purchased ? "Lab: exact purchase retry" : "Lab: normal purchase",
      target: fixture.item.id,
    });
    const before = (firstTrace || trace).before;
    const after = trace.after;
    const buyerBefore = before?.guilds.find((g) => g.id === fixture.buyer);
    const buyerAfter = after?.guilds.find((g) => g.id === fixture.buyer);
    const sellerBefore = before?.guilds.find((g) => g.id === fixture.seller);
    const sellerAfter = after?.guilds.find((g) => g.id === fixture.seller);
    const owner = after?.items.find((i) => i.id === fixture.item.id)?.owner_id;
    const observable = !!(
      buyerBefore &&
      buyerAfter &&
      sellerBefore &&
      sellerAfter &&
      buyerAfter.gold === buyerBefore.gold - 100 &&
      sellerAfter.gold === sellerBefore.gold + 100 &&
      owner === fixture.buyer
    );
    setResult({
      source:
        "Client observations; independent integration tests remain required",
      expectation: observable
        ? "Observed expected net transfer and ownership"
        : "Unavailable or expectation not observed",
      replayed: trace.reply?.replayed,
      response: trace.reply,
      wallets: { buyerBefore, buyerAfter, sellerBefore, sellerAfter },
      owner,
      firstResponse: firstTrace?.reply,
    });
    if (!firstTrace) setFirstTrace(trace);
    setPurchased(true);
  }
  async function bid(second = false) {
    if (!fixture?.auction) return;
    const actor = second ? fixture.bidder : fixture.buyer;
    const trace = await run({
      method: "POST",
      path: `/auctions/${fixture.auction.id}/bids`,
      body: { bidder_id: actor, amount: second ? 110 : 100 },
      key: newKey(),
      actor,
      label: "Lab: " + (second ? "outbid" : "first bid"),
      target: fixture.item.id,
    });
    setFixture({
      ...fixture,
      [second ? "second" : "first"]: trace.reply!.data as Bid,
    });
    setResult({
      source: "Real bid endpoint and independent snapshot",
      before: trace.before,
      after: trace.after,
      response: trace.reply,
    });
    selectGuild(actor);
  }
  async function cancel(invalid = false) {
    if (!fixture?.auction) return;
    const b = invalid ? fixture.first : fixture.second || fixture.first;
    if (!b) return;
    try {
      const trace = await run({
        method: "DELETE",
        path: `/auctions/${fixture.auction.id}/bids/${b.id}?bidder_id=${encodeURIComponent(b.bidder_id)}`,
        actor: b.bidder_id,
        label:
          "Lab: " + (invalid ? "invalid cancellation" : "cancel highest bid"),
      });
      setResult({
        source: "Client observation",
        response: trace.reply,
        after: trace.after,
      });
      if (invalid)
        throw new Error("Unexpected acceptance: inspect the backend state");
    } catch (e) {
      if (invalid && e instanceof APIError && e.status === 409) {
        setResult({
          source: "Real HTTP response",
          outcome: "Expected business-rule rejection",
          status: e.status,
          message: e.message,
        });
        return;
      }
      throw e;
    }
  }
  async function harness() {
    const response = await fetch("/lab/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario }),
      signal: AbortSignal.timeout(180000),
    });
    const body = (await response.json()) as Report;
    if (!response.ok) throw new Error(body.output || "Harness unavailable");
    setReport(body);
  }
  const current = scenarios.find((s) => s[0] === scenario)!;
  return (
    <>
      <div className="lab-banner">
        <FlaskConical size={27} />
        <div>
          <h2>A laboratory, connected to reality.</h2>
          <p>
            A/B/D/E create unique fixtures in{" "}
            <b>{data?.database || "unavailable"}</b> through real APIs. C/F/G
            {REVIEW_MODE
              ? "require the local isolated harness; execution is unavailable on this hosted site. No resets."
              : "run in a fresh disposable PostgreSQL container, isolated from this database. No resets."}
          </p>
        </div>
        <Badge tone="gold">DEVELOPMENT ONLY</Badge>
      </div>
      <div className="lab-layout">
        <div className="scenario-list">
          {scenarios.map(([id, letter, title, description]) => (
            <button
              key={id}
              disabled={busy}
              className={scenario === id ? "selected" : ""}
              onClick={() => {
                setScenario(id);
                setFixture(undefined);
                setResult(undefined);
                setReport(undefined);
                setError("");
                setPurchased(false);
              }}
            >
              <b>{letter}</b>
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
        <section className="panel scenario-panel">
          <div className="eyebrow">SCENARIO {current[1]}</div>
          <h2>{current[2]}</h2>
          <p>{current[3]}</p>
          {["competing-buyers", "rollback", "settlement"].includes(scenario) ? (
            <>
              <div className="safety-note">
                <Shield size={19} />
                <p>
                  {REVIEW_MODE
                    ? "Hosted execution is unavailable. Run this scenario locally using the reproduction guide and independently inspect persisted-state assertions. Recorded results describe a prior run, not a test executed on this deployment."
                    : "Runs an allowlisted Go test in a new Testcontainers process. The harness supplies no application database URL and never resets shared state. A pass requires persisted-state assertions, not merely HTTP outcomes."}
                </p>
              </div>
              <button
                className="primary"
                disabled={busy || REVIEW_MODE}
                onClick={() => void task(harness)}
              >
                <Play size={15} />
                {REVIEW_MODE
                  ? "Local harness required"
                  : busy
                    ? "Running isolated test…"
                    : "Run isolated scenario"}
              </button>
              {REVIEW_MODE && (
                <p>
                  <a
                    href="https://github.com/houtanrocky/dragon-market/blob/feat/human-review-deployment/docs/research-readiness/reproduction-guide.md"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Reproduction instructions and recorded evidence
                  </a>
                </p>
              )}
              {report && (
                <>
                  <h3>
                    <Badge tone={report.status === "PASS" ? "green" : "red"}>
                      {report.status}
                    </Badge>{" "}
                    {report.environment}
                  </h3>
                  <p>
                    <code>{report.command}</code>
                  </p>
                  <Json value={report.report} />
                  <details open>
                    <summary>Actual Go test output</summary>
                    <pre>{report.output}</pre>
                  </details>
                </>
              )}
            </>
          ) : (
            <>
              <ol className="lab-steps">
                <li>Create fresh guilds and an eligible artifact.</li>
                <li>
                  {scenario === "purchase" || scenario === "retry"
                    ? "Create a fixed-price listing. Inspect the initial state."
                    : "Start a legendary auction. Place bids from different guilds."}
                </li>
                <li>
                  Execute the operation, then compare real responses and
                  persisted snapshots.
                </li>
              </ol>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void task(() =>
                    prepare(["bidding", "cancellation"].includes(scenario)),
                  )
                }
              >
                <PlusIcon />
                {fixture ? "Prepare new fixture" : "Prepare unique fixture"}
              </button>
              {fixture && (
                <>
                  <div className="fixture-meta">
                    <Badge tone="green">
                      <Check size={12} />
                      Fixture ready
                    </Badge>
                    <p>
                      Seller: {fixture.seller}
                      <br />
                      Buyer: {fixture.buyer}
                      <br />
                      Other bidder: {fixture.bidder}
                    </p>
                    <code>{fixture.item.id}</code>
                  </div>
                  {["purchase", "retry"].includes(scenario) ? (
                    <>
                      <label className="field">
                        <span>Logical purchase key</span>
                        <input
                          aria-label="Lab idempotency key"
                          value={fixture.key}
                          disabled={purchased}
                          onChange={(e) =>
                            setFixture({ ...fixture, key: e.target.value })
                          }
                        />
                      </label>
                      <button
                        className="primary"
                        disabled={
                          busy || (purchased && scenario === "purchase")
                        }
                        onClick={() => void task(purchase)}
                      >
                        {purchased
                          ? "Repeat exact purchase with same key"
                          : "Submit purchase"}
                        <ArrowRight size={15} />
                      </button>
                    </>
                  ) : (
                    <div className="button-row">
                      <button
                        className="primary"
                        disabled={busy || !!fixture.first}
                        onClick={() => void task(() => bid(false))}
                      >
                        First bid · 100 units
                      </button>
                      <button
                        className="primary"
                        disabled={busy || !fixture.first || !!fixture.second}
                        onClick={() => void task(() => bid(true))}
                      >
                        Outbid · 110 units
                      </button>
                      <button
                        className="secondary"
                        disabled={busy || !fixture.first}
                        onClick={() => void task(() => cancel())}
                      >
                        Cancel highest bid
                      </button>
                      <button
                        className="secondary"
                        disabled={busy || !fixture.second}
                        onClick={() => void task(() => cancel(true))}
                      >
                        Attempt invalid cancellation
                      </button>
                    </div>
                  )}
                </>
              )}
              {result !== undefined && (
                <details open>
                  <summary>Observed results and response evidence</summary>
                  <Json value={result} />
                </details>
              )}
            </>
          )}
          {busy && (
            <p role="status">
              Working with real infrastructure. No simulated results.
            </p>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}. The optional runner starts with RESEARCH_LAB=1; see the
              reproduction guide.
            </div>
          )}
          <p className="caption">
            Matching responses do not prove mathematical correctness or
            exactly-once behavior. Inspect independent Go test evidence and
            request traces before drawing conclusions.
          </p>
        </section>
      </div>
    </>
  );
}
function PlusIcon() {
  return <span aria-hidden="true">＋</span>;
}
