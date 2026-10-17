import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownUp,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  FlaskConical,
  Gavel,
  Gem,
  LayoutGrid,
  Menu,
  Package,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Shield,
  Sparkles,
  Store,
  Wallet as WalletIcon,
  X,
} from "lucide-react";
import {
  API_BASE,
  APIError,
  canList,
  gold,
  integer,
  mutate,
  newKey,
  nextBid,
  request,
  snapshot,
} from "./api";
import type {
  Auction,
  Bid,
  Item,
  Mutation,
  Order,
  Snapshot,
  Trace,
} from "./contracts";
import {
  Artifact,
  Badge,
  Dialog,
  Empty,
  Field,
  Json,
  Money,
  WalletView,
} from "./components";
import { ResearchLab } from "./ResearchLab";

const navigation = [
  ["overview", "Overview", LayoutGrid],
  ["marketplace", "Marketplace", Store],
  ["items", "My Items", Package],
  ["orders", "Orders", ScrollText],
  ["auctions", "Auctions", Gavel],
  ["wallet", "Wallet", WalletIcon],
  ["inspector", "Transaction Inspector", ArrowDownUp],
  ["lab", "Research Lab", FlaskConical],
  ["status", "System Status", Activity],
] as const;
type Page = (typeof navigation)[number][0];
type Editor = {
  kind:
    | "item"
    | "guild"
    | "list"
    | "auction"
    | "bid"
    | "buy"
    | "cancel-order"
    | "cancel-bid"
    | "replay";
  item?: Item;
  order?: Order;
  auction?: Auction;
  bid?: Bid;
  mutation?: Mutation;
  key?: string;
};
const pageFromHash = (): Page =>
  navigation.find((n) => n[0] === location.hash.slice(1))?.[0] || "overview";

export function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [data, setData] = useState<Snapshot>();
  const [actor, setActor] = useState(
    () => sessionStorage.getItem("aethoria-guild") || "guild-seller",
  );
  const [traces, setTraces] = useState<Trace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [editor, setEditor] = useState<Editor>();
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [menu, setMenu] = useState(false);
  const activeRead = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    setLoading(true);
    try {
      const next = await snapshot(controller.signal);
      if (!controller.signal.aborted) {
        setData(next);
        setError("");
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Cannot reach backend");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    return () => activeRead.current?.abort();
  }, [refresh]);
  useEffect(() => {
    const onHash = () => {
      setPage(pageFromHash());
      setMenu(false);
      requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        document.getElementById("main-content")?.focus({ preventScroll: true });
      });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    sessionStorage.setItem("aethoria-guild", actor);
  }, [actor]);
  const wallet = data?.guilds.find((g) => g.id === actor);
  const open = (e: Editor) => {
    setFormError("");
    setEditor(e);
  };
  const run = useCallback(async (m: Mutation) => {
    const trace: Trace = {
      id: newKey(),
      at: new Date().toISOString(),
      request: structuredClone(m),
    };
    try {
      trace.before = await snapshot();
    } catch (e) {
      trace.observationError = `Before snapshot unavailable: ${String(e)}`;
    }
    let failure: unknown;
    try {
      trace.reply = await mutate(m);
    } catch (e) {
      failure = e;
      trace.error = e instanceof Error ? e.message : String(e);
      if (e instanceof APIError)
        trace.reply = {
          status: e.status,
          data: e.payload,
          requestId: e.requestId,
          replayed: false,
        };
    }
    try {
      trace.after = await snapshot();
      setData(trace.after);
    } catch (e) {
      trace.observationError =
        (trace.observationError || "") +
        ` After snapshot unavailable: ${String(e)}`;
    }
    setTraces((previous) => [trace, ...previous].slice(0, 50));
    if (failure) throw failure;
    setNotice(`${m.label} completed. Inspect the observed state transition.`);
    return trace;
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const f = new FormData(event.currentTarget);
    setBusy(true);
    setFormError("");
    const text = (name: string) => String(f.get(name) || "").trim();
    try {
      let m: Mutation;
      switch (editor.kind) {
        case "guild":
          m = {
            method: "POST",
            path: "/guilds",
            body: {
              id: text("id"),
              gold: integer(f.get("gold"), false),
              daily_limit: integer(f.get("daily_limit"), false),
            },
            actor: text("id"),
            label: "Create guild",
          };
          break;
        case "item":
          m = {
            method: "POST",
            path: "/items",
            body: {
              name: text("name"),
              type: text("type"),
              owner_id: actor,
              base_price: integer(f.get("price")),
            },
            actor,
            label: "Create item",
          };
          break;
        case "list":
          m = {
            method: "POST",
            path: "/orders",
            body: {
              item_id: editor.item!.id,
              owner_id: actor,
              base_price: integer(f.get("price")),
            },
            actor,
            label: "Create listing",
            target: editor.item!.id,
          };
          break;
        case "auction":
          m = {
            method: "POST",
            path: "/auctions",
            body: { item_id: editor.item!.id, seller_id: actor },
            actor,
            label: "Start auction",
            target: editor.item!.id,
          };
          break;
        case "buy":
          m = {
            method: "POST",
            path: `/orders/${editor.order!.id}/buy`,
            body: { buyer_id: actor },
            key: editor.key,
            actor,
            label: "Purchase order",
            target: editor.order!.item_id,
          };
          break;
        case "bid":
          m = {
            method: "POST",
            path: `/auctions/${editor.auction!.id}/bids`,
            body: { bidder_id: actor, amount: integer(f.get("amount")) },
            key: editor.key,
            actor,
            label: "Place bid",
            target: editor.auction!.item_id,
          };
          break;
        case "cancel-order":
          m = {
            method: "DELETE",
            path: `/orders/${editor.order!.id}`,
            body: { seller_id: actor },
            actor,
            label: "Cancel listing",
            target: editor.order!.item_id,
          };
          break;
        case "cancel-bid":
          m = {
            method: "DELETE",
            path: `/auctions/${editor.bid!.auction_id}/bids/${editor.bid!.id}?bidder_id=${encodeURIComponent(actor)}`,
            actor,
            label: "Cancel highest bid",
          };
          break;
        case "replay":
          m = editor.mutation!;
          break;
      }
      await run(m);
      if (editor.kind === "guild") setActor(text("id"));
      setEditor(undefined);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const items = (data?.items || []).filter(
    (i) =>
      (page !== "items" || i.owner_id === actor) &&
      (filter === "all" || i.type === filter) &&
      `${i.name} ${i.owner_id} ${i.id}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const itemName = (id: string) =>
    data?.items.find((i) => i.id === id)?.name || id;
  const activeOrders = data?.orders.filter((o) => o.status === "listed") || [];
  const activeAuctions =
    data?.auctions.filter((a) => a.status === "active") || [];
  const title = navigation.find((n) => n[0] === page)![1];
  function itemActions(item: Item) {
    return canList(item, actor) ? (
      <button
        className="card-action"
        onClick={() =>
          open({ kind: item.type === "legendary" ? "auction" : "list", item })
        }
      >
        {item.type === "legendary" ? "Start auction" : "Create listing"}
        <ArrowRight size={16} />
      </button>
    ) : (
      <span className="card-action muted">
        {item.status === "free"
          ? "Owned by another guild"
          : "Inspect in " +
            (item.status === "listed_in_order" ? "Orders" : "Auctions")}
        <ChevronRight size={15} />
      </span>
    );
  }
  function itemGrid(list: Item[]) {
    return list.length ? (
      <div className="item-grid">
        {list.map((i) => (
          <article className="item-card" key={i.id}>
            <div className="card-art">
              <Artifact item={i} />
              <Badge tone={i.type}>{i.type}</Badge>
              <span className="item-state">
                {i.status.replaceAll("_", " ")}
              </span>
            </div>
            <div className="card-body">
              <small className="eyebrow">
                {i.type === "legendary" ? "One of a kind" : "Guild collection"}
              </small>
              <h3>{i.name}</h3>
              <p className="owner">{i.owner_id}</p>
              <div className="card-price">
                <span>
                  Base price<small>Oracle may refresh</small>
                </span>
                <Money value={i.base_price} />
              </div>
              {itemActions(i)}
            </div>
          </article>
        ))}
      </div>
    ) : (
      <Empty title="Your next discovery starts here">
        {page === "items"
          ? "This guild has no matching items. Create an item to begin."
          : "No matching artifacts in this persisted page. Create an item or change the filters."}
      </Empty>
    );
  }
  return (
    <div className="app">
      <a
        className="skip"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <a className="brand" href="#overview">
          <span className="brand-mark">
            <Gem size={28} />
          </span>
          <span>
            DRAGON MARKET<small>A E T H O R I A</small>
          </span>
        </a>
        <div className="realm">
          <i className="dot green" />
          <span>Local development realm</span>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map(([id, label, Icon], index) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={page === id ? "page" : undefined}
              className={`${page === id ? "active" : ""} ${index === 6 ? "nav-divider" : ""}`}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "lab" && <small>DEV</small>}
            </a>
          ))}
        </nav>
        <div className="sidebar-note">
          <Shield size={20} />
          <h4>A transparent economy</h4>
          <p>Real requests. Persisted state. Independently tested behavior.</p>
          <a href="#lab">
            Explore the research lab <ArrowRight size={14} />
          </a>
        </div>
        <div className="sidebar-bottom">
          <BookOpen size={16} />
          <span>
            Candidate baseline
            <br />
            <small>Human review pending</small>
          </span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
          <div className="breadcrumb">
            Aethoria <ChevronRight size={13} />
            <span>{title}</span>
          </div>
          <div className="topbar-right">
            <Badge tone="gold">DEVELOPMENT ONLY</Badge>
            <label className="guild-switch">
              <Shield size={17} />
              <span>
                <small>Development Guild Switcher · not authentication</small>
                <select
                  aria-label="Development Guild Switcher"
                  value={actor}
                  onChange={(e) => setActor(e.target.value)}
                >
                  {Array.from(
                    new Set([
                      "guild-seller",
                      "guild-buyer",
                      "guild-bidder",
                      actor,
                      ...(data?.guilds.map((g) => g.id) || []),
                    ]),
                  ).map((id) => (
                    <option key={id}>{id}</option>
                  ))}
                </select>
              </span>
            </label>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="tiny-line" /> THE AETHORIA EXCHANGE
              </div>
              <h1>{page === "overview" ? "Welcome to the realm." : title}</h1>
              <p>
                {
                  {
                    overview:
                      "A living marketplace. An economy you can inspect.",
                    marketplace:
                      "Discover artifacts, forge listings, and follow the gold.",
                    items: "Your collection, recorded in the realm’s ledger.",
                    orders: "Fixed prices. Atomic purchases. Clear outcomes.",
                    auctions:
                      "Legendary artifacts deserve a little competition.",
                    wallet:
                      "Every coin accounted for. Every reservation visible.",
                    inspector:
                      "Follow a request from intention to observed state.",
                    lab: "Explore transactional behavior in a controlled environment.",
                    status:
                      "Availability is observable. Correctness requires evidence.",
                  }[page]
                }
              </p>
            </div>
            <button
              className="secondary"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw size={15} className={loading ? "spin" : ""} />
              {loading ? "Refreshing" : "Refresh state"}
            </button>
          </div>
          {error && (
            <div role="alert" className="alert">
              <strong>Backend state unavailable</strong>
              <p>
                {error}. Start the Go backend with APP_ENV=development and
                PostgreSQL. The workbench requires /dev/snapshot; stale state
                below must not be treated as current.
              </p>
              <button onClick={() => void refresh()}>Retry connection</button>
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              <Check size={16} />
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {data && (
            <div className="source-line">
              <i className="dot green" /> Persisted snapshot ·{" "}
              {new Date(data.observed_at).toLocaleTimeString()} ·{" "}
              {data.database}@{data.database_address}
              <span>
                Up to {data.limit} records per collection
                {Object.values(data.counts).some((n) => n > data.limit)
                  ? " · PARTIAL PAGE — full totals in System Status"
                  : ""}
              </span>
            </div>
          )}
          {loading && !data && (
            <div role="status" className="loading">
              <RefreshCw className="spin" /> Reading the realm’s ledger…
            </div>
          )}
          {page === "overview" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <Badge tone="gold">
                    <Sparkles size={12} /> THE GUILD EXCHANGE
                  </Badge>
                  <h2>
                    Extraordinary artifacts.
                    <br />
                    <em>Observable transactions.</em>
                  </h2>
                  <p>
                    Trade the treasures of Aethoria, follow every reservation,
                    and see the stories behind the ledger.
                  </p>
                  <div className="button-row">
                    <a className="primary" href="#marketplace">
                      Explore marketplace <ArrowRight size={16} />
                    </a>
                    <a className="hero-link" href="#lab">
                      <FlaskConical size={16} /> Open research lab
                    </a>
                  </div>
                  <div className="hero-caption">
                    <i className="dot green" /> Real Go backend <span>·</span>{" "}
                    PostgreSQL persistence <span>·</span> Local environment
                  </div>
                </div>
                <div className="hero-seal" aria-hidden="true">
                  <div className="seal-orbit" />
                  <Gem />
                  <span>THE REALM OF AETHORIA</span>
                  <b>✦</b>
                </div>
              </section>
              <div className="stats">
                {[
                  [Gem, "Artifacts recorded", data?.counts.items],
                  [ScrollText, "Listed orders (page)", activeOrders.length],
                  [Gavel, "Active auctions (page)", activeAuctions.length],
                  [Shield, "Guilds in the realm", data?.counts.guilds],
                ].map(([Icon, label, value]) => {
                  const StatIcon = Icon as typeof Gem;
                  return (
                    <div className="stat" key={String(label)}>
                      <span className="stat-icon">
                        <StatIcon size={21} />
                      </span>
                      <div>
                        <small>{String(label)}</small>
                        <strong>
                          {value === undefined ? "—" : String(value)}
                        </strong>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="overview-columns">
                <section>
                  <div className="section-head">
                    <div>
                      <div className="eyebrow">FROM THE LEDGER</div>
                      <h2>Artifacts of the realm</h2>
                    </div>
                    <a href="#marketplace">
                      View all <ArrowRight size={14} />
                    </a>
                  </div>
                  {itemGrid((data?.items || []).slice(0, 3))}
                </section>
                <div className="overview-right">
                  {wallet ? (
                    <WalletView wallet={wallet} />
                  ) : (
                    <Empty title="Guild wallet unavailable">
                      Select an existing guild or create one in Wallet.
                    </Empty>
                  )}
                  <a href="#inspector" className="inspector-promo">
                    <ArrowDownUp size={23} />
                    <h3>Look beneath the trade</h3>
                    <p>
                      Compare wallet and ownership snapshots around your
                      requests.
                    </p>
                    <span>
                      Open Transaction Inspector <ArrowRight size={15} />
                    </span>
                  </a>
                </div>
              </div>
            </>
          )}
          {(page === "marketplace" || page === "items") && (
            <>
              <div className="toolbar">
                <div className="tabs" aria-label="Item rarity">
                  {["all", "common", "rare", "legendary"].map((t) => (
                    <button
                      key={t}
                      aria-pressed={filter === t}
                      className={filter === t ? "selected" : ""}
                      onClick={() => setFilter(t)}
                    >
                      {t === "all" ? "All artifacts" : t}
                    </button>
                  ))}
                </div>
                <button
                  className="primary"
                  onClick={() => open({ kind: "item" })}
                >
                  <Plus size={16} />
                  Create item
                </button>
              </div>
              <label className="search">
                <Search size={17} />
                <input
                  aria-label="Search items"
                  placeholder="Search artifacts, guilds, or item IDs…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <small>{items.length} on this page</small>
              </label>
              {itemGrid(items)}
            </>
          )}
          {page === "orders" && (
            <>
              <div className="info-strip">
                <ScrollText size={18} />
                <p>
                  Common & rare artifacts use fixed-price listings. Prices are
                  locked at listing time. Multiple listings for one item may
                  exist; a successful purchase cancels the others.
                </p>
                <a href="#items">
                  List an item <ArrowRight size={14} />
                </a>
              </div>
              {data?.orders.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Artifact / order</th>
                        <th>Seller → buyer</th>
                        <th>Locked price</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.orders.map((o) => (
                        <tr key={o.id}>
                          <td>
                            <strong>{itemName(o.item_id)}</strong>
                            <code>{o.id}</code>
                          </td>
                          <td>
                            {o.seller_id}
                            <small>
                              {o.buyer_id
                                ? `→ ${o.buyer_id}`
                                : "Awaiting buyer"}
                            </small>
                          </td>
                          <td>
                            <Money value={o.price} />
                          </td>
                          <td>
                            <Badge
                              tone={
                                o.status === "sold"
                                  ? "green"
                                  : o.status === "listed"
                                    ? "gold"
                                    : "muted"
                              }
                            >
                              {o.status}
                            </Badge>
                          </td>
                          <td>
                            {o.status === "listed" &&
                              (o.seller_id === actor ? (
                                <button
                                  className="secondary"
                                  onClick={() =>
                                    open({ kind: "cancel-order", order: o })
                                  }
                                >
                                  Cancel listing
                                </button>
                              ) : (
                                <button
                                  className="primary"
                                  onClick={() =>
                                    open({
                                      kind: "buy",
                                      order: o,
                                      key: newKey(),
                                    })
                                  }
                                >
                                  Purchase
                                </button>
                              ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="The order book is open">
                  Create a common or rare item, then list it from My Items.
                </Empty>
              )}
            </>
          )}
          {page === "auctions" && (
            <>
              <div className="info-strip">
                <Gavel size={20} />
                <p>
                  Backend deadlines are UTC. Minimum increment: 5%, rounded up
                  in smallest units. Bids in the final five minutes extend the
                  deadline by five minutes. Refresh to inspect worker
                  settlement.
                </p>
              </div>
              <div className="auction-grid">
                {data?.auctions.map((a) => {
                  const artifact = data.items.find((i) => i.id === a.item_id);
                  const bids = data.bids.filter((b) => b.auction_id === a.id);
                  const top = bids.find((b) => b.status === "active");
                  return (
                    <article key={a.id} className="auction-card">
                      <Artifact
                        item={
                          artifact || {
                            name: "Unknown artifact",
                            type: "legendary",
                          }
                        }
                        small
                      />
                      <div>
                        <div className="section-head">
                          <Badge
                            tone={a.status === "active" ? "gold" : "green"}
                          >
                            {a.status}
                          </Badge>
                          <small>UTC DEADLINE</small>
                        </div>
                        <h2>{itemName(a.item_id)}</h2>
                        <code>{a.id}</code>
                        <p>
                          {new Date(a.ends_at).toISOString()}
                          <br />
                          <small>
                            Your local time:{" "}
                            {new Date(a.ends_at).toLocaleString()}
                          </small>
                        </p>
                        <div className="auction-price">
                          <span>
                            {top ? "Highest active bid" : "No active bids"}
                            <small>
                              {top?.bidder_id ||
                                "First bid can be any positive amount"}
                            </small>
                          </span>
                          {top && <Money value={top.amount} />}
                        </div>
                        {top && (
                          <p>
                            Next eligible amount ≥{" "}
                            {nextBid(top.amount) === null
                              ? "unavailable (numeric range)"
                              : `${nextBid(top.amount)} smallest units`}
                          </p>
                        )}
                        {a.status === "active" && a.seller_id !== actor && (
                          <button
                            className="primary"
                            onClick={() =>
                              open({ kind: "bid", auction: a, key: newKey() })
                            }
                          >
                            Place bid <Gavel size={15} />
                          </button>
                        )}
                        <details>
                          <summary>
                            Bid history on this page ({bids.length})
                          </summary>
                          {bids.map((b) => (
                            <div className="bid-row" key={b.id}>
                              <span>
                                {b.bidder_id}
                                <small>{b.status}</small>
                              </span>
                              <Money value={b.amount} />
                              {b.status === "active" &&
                                b.bidder_id === actor &&
                                a.status === "active" && (
                                  <button
                                    className="secondary"
                                    onClick={() =>
                                      open({ kind: "cancel-bid", bid: b })
                                    }
                                  >
                                    Cancel highest bid
                                  </button>
                                )}
                            </div>
                          ))}
                        </details>
                        <small>
                          Eligibility is checked by the backend, including
                          deadlines. Ended auctions retain winning bid history.
                        </small>
                      </div>
                    </article>
                  );
                })}
              </div>
              {!data?.auctions.length && (
                <Empty title="Legendary stories begin here">
                  Create a legendary item, then start its auction from My Items.
                </Empty>
              )}
            </>
          )}
          {page === "wallet" && (
            <>
              <div className="section-head">
                <h2>{actor}</h2>
                <button
                  className="primary"
                  onClick={() => open({ kind: "guild" })}
                >
                  <Plus size={16} />
                  Create guild
                </button>
              </div>
              <div className="wallet-layout">
                {wallet && <WalletView wallet={wallet} />}
                <section className="panel">
                  <div className="eyebrow">THE WALLET EQUATION</div>
                  <h2>Reserved is still yours.</h2>
                  <p>
                    Placing a bid reserves available gold. Being outbid or
                    cancelling an eligible bid releases it. Settlement deducts
                    reserved funds and pays the seller.
                  </p>
                  <p>
                    Inputs use integer smallest units.{" "}
                    <b>100 units = 1.00 G.</b> A daily limit of zero means
                    unlimited.
                  </p>
                  <p>
                    The development guild switcher is a local identity selector.
                    It provides no authentication or authorization.
                  </p>
                </section>
              </div>
              <div className="section-head">
                <h2>Persisted wallet audit</h2>
                <Badge>Read-only · bounded page</Badge>
              </div>
              <AuditTable data={data} guild={actor} />
            </>
          )}
          {page === "inspector" && (
            <Inspector
              traces={traces}
              data={data}
              onReplay={(m) => open({ kind: "replay", mutation: m })}
            />
          )}
          {page === "lab" && (
            <ResearchLab run={run} data={data} selectGuild={setActor} />
          )}
          {page === "status" && <SystemStatus data={data} error={error} />}
          <footer>
            <span>
              <Gem size={13} /> DRAGON MARKET <b>·</b> AETHORIA
            </span>
            <span>
              Development workbench · Candidate research baseline ·
              PENDING_HUMAN_REVIEW
            </span>
          </footer>
        </main>
      </div>
      {editor && (
        <Dialog
          title={
            {
              item: "Create an artifact",
              guild: "Create development guild",
              list: "Create fixed-price listing",
              auction: "Start legendary auction",
              bid: "Place a bid",
              buy: "Confirm purchase",
              "cancel-order": "Cancel listing",
              "cancel-bid": "Cancel highest bid",
              replay: "Repeat the exact request",
            }[editor.kind]
          }
          onClose={() => {
            if (!busy) setEditor(undefined);
          }}
        >
          <form onSubmit={submit}>
            <p className="dialog-note">
              Real backend mutation · Actor:{" "}
              <b>{editor.mutation?.actor || actor}</b>. Changes persist in the
              active development database.
            </p>
            {editor.kind === "item" && (
              <>
                <Field label="Artifact name">
                  <input
                    name="name"
                    required
                    maxLength={160}
                    autoFocus
                    placeholder="e.g. Emberglass blade"
                  />
                </Field>
                <Field label="Item type">
                  <select name="type">
                    <option value="common">Common</option>
                    <option value="rare">Rare</option>
                    <option value="legendary">Legendary</option>
                  </select>
                </Field>
                <Field label="Base price (integer smallest units)">
                  <input
                    name="price"
                    type="number"
                    min="1"
                    max={Number.MAX_SAFE_INTEGER}
                    step="1"
                    defaultValue="500"
                    required
                  />
                </Field>
                <p>
                  100 smallest units = 1.00 G. The oracle may later refresh this
                  base price.
                </p>
              </>
            )}
            {editor.kind === "guild" && (
              <>
                <Field label="Guild ID">
                  <input
                    name="id"
                    required
                    maxLength={120}
                    pattern="[A-Za-z0-9_-]+"
                    autoFocus
                    placeholder="guild-explorer"
                  />
                </Field>
                <Field label="Initial gold (smallest units)">
                  <input
                    name="gold"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue="10000"
                    required
                  />
                </Field>
                <Field label="Daily limit (0 means unlimited)">
                  <input
                    name="daily_limit"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue="5000"
                    required
                  />
                </Field>
              </>
            )}
            {editor.kind === "list" && (
              <>
                <h3>{editor.item?.name}</h3>
                <Field label="Listing price (integer smallest units)">
                  <input
                    name="price"
                    type="number"
                    min="1"
                    step="1"
                    defaultValue={editor.item?.base_price}
                    required
                    autoFocus
                  />
                </Field>
              </>
            )}
            {editor.kind === "auction" && (
              <p>
                Start a 24-hour auction for <b>{editor.item?.name}</b>. The
                backend sets the deadline and determines eligibility.
              </p>
            )}
            {editor.kind === "bid" && (
              <Field label="Bid amount (integer smallest units)">
                <input
                  name="amount"
                  type="number"
                  min="1"
                  step="1"
                  required
                  autoFocus
                />
              </Field>
            )}
            {editor.kind === "buy" && (
              <p>
                Purchase <b>{itemName(editor.order!.item_id)}</b> for{" "}
                <Money value={editor.order!.price} />. Wallet, ownership, order
                and audit changes are handled by the backend transaction.
              </p>
            )}
            {editor.kind.startsWith("cancel") && (
              <p>
                This releases the eligible listing or bid reservation. The
                backend may reject the request if its current state has changed.
              </p>
            )}
            {editor.key && (
              <div className="key-box">
                <Field label="Idempotency key">
                  <input
                    value={editor.key}
                    onChange={(e) =>
                      setEditor({ ...editor, key: e.target.value })
                    }
                    required
                  />
                </Field>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setEditor({ ...editor, key: newKey() })}
                >
                  Start a new logical operation with a new key
                </button>
                <small>
                  On a failed/uncertain request, keep this key and unchanged
                  inputs to retry. Changing inputs with the same key can be
                  rejected. Completed requests can be repeated exactly in
                  Transaction Inspector.
                </small>
              </div>
            )}
            {editor.kind === "replay" && (
              <>
                <Json value={editor.mutation} />
                <p>
                  The actor, body, target and key remain identical, regardless
                  of the current guild selection. Matching responses alone do
                  not prove exactly-once effects.
                </p>
              </>
            )}
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setEditor(undefined)}
                disabled={busy}
              >
                Back
              </button>
              <button className="primary" disabled={busy}>
                {busy
                  ? "Submitting…"
                  : editor.kind === "replay"
                    ? "Repeat with same key"
                    : "Confirm " +
                      (editor.kind === "buy"
                        ? "purchase"
                        : editor.kind.replaceAll("-", " "))}
                <ArrowRight size={15} />
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}

function AuditTable({ data, guild }: { data?: Snapshot; guild?: string }) {
  const rows = data?.audit.filter((a) => !guild || a.guild_id === guild) || [];
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Audit ID / UTC time</th>
            <th>Guild / operation</th>
            <th>Amount</th>
            <th>Total after</th>
            <th>Reserved after</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>
                #{a.id}
                <small>{a.created_at}</small>
              </td>
              <td>
                {a.guild_id}
                <small>{a.operation}</small>
              </td>
              <td>
                <Money value={a.amount} />
              </td>
              <td>
                <Money value={a.gold_after} />
              </td>
              <td>
                <Money value={a.reserved_after} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="No audit rows on this page">
      Successful wallet mutations append records inside their transaction.
    </Empty>
  );
}

function Inspector({
  traces,
  data,
  onReplay,
}: {
  traces: Trace[];
  data?: Snapshot;
  onReplay: (m: Mutation) => void;
}) {
  const [selected, setSelected] = useState<string>();
  const t = traces.find((t) => t.id === selected) || traces[0];
  const wallets =
    t?.before?.guilds.filter((g) => {
      const after = t.after?.guilds.find((a) => a.id === g.id);
      return (
        g.id === t.request.actor ||
        (after &&
          (g.gold !== after.gold ||
            g.reserved !== after.reserved ||
            g.daily_spent !== after.daily_spent))
      );
    }) || [];
  return (
    <>
      <div className="info-strip">
        <CircleHelp size={20} />
        <p>
          Client-side observations, held in memory (latest 50; cleared on
          refresh). Snapshots are independently read before and after;
          concurrent operations may contribute to differences. Audit rows have
          no request correlation field.
        </p>
      </div>
      <div className="inspector-layout">
        <section className="trace-list panel">
          <h2>
            Observed operations <Badge>{traces.length}</Badge>
          </h2>
          {traces.map((v) => (
            <button
              key={v.id}
              className={`trace ${t?.id === v.id ? "selected" : ""}`}
              onClick={() => setSelected(v.id)}
            >
              <span className={`trace-icon ${v.error ? "bad" : "good"}`}>
                {v.error ? <X size={17} /> : <Check size={17} />}
              </span>
              <span>
                <strong>{v.request.label}</strong>
                <small>
                  {v.request.actor} · {new Date(v.at).toLocaleTimeString()}
                </small>
              </span>
              <Badge tone={v.error ? "red" : "green"}>
                {v.reply?.status || "Network error"}
              </Badge>
            </button>
          ))}
          {!traces.length && (
            <p>Operations you initiate here appear as they finish.</p>
          )}
        </section>
        <section className="panel trace-detail">
          {t ? (
            <>
              <div className="section-head">
                <div>
                  <div className="eyebrow">CLIENT OBSERVATION</div>
                  <h2>{t.request.label}</h2>
                </div>
                <Badge tone={t.error ? "red" : "green"}>
                  {t.error ? "Rejected / failed" : "HTTP completed"}
                </Badge>
              </div>
              <dl className="metadata">
                <dt>Timestamp (UTC)</dt>
                <dd>{t.at}</dd>
                <dt>Actor</dt>
                <dd>{t.request.actor}</dd>
                <dt>Target</dt>
                <dd>{t.request.target || t.request.path}</dd>
                <dt>Request ID</dt>
                <dd>{t.reply?.requestId || "Unavailable"}</dd>
                <dt>Idempotency key</dt>
                <dd>{t.request.key || "Not applicable"}</dd>
                <dt>Backend replay header</dt>
                <dd>{t.reply?.replayed ? "true" : "false / unavailable"}</dd>
              </dl>
              {t.error && <p className="form-error">{t.error}</p>}
              {t.observationError && <p role="alert">{t.observationError}</p>}
              <h3>Wallet observations</h3>
              {wallets.map((before) => {
                const after = t.after?.guilds.find((g) => g.id === before.id);
                return (
                  <div className="comparison" key={before.id}>
                    <b>{before.id}</b>
                    <span>
                      Total: {gold(before.gold)} →{" "}
                      {after ? gold(after.gold) : "Unavailable"} G
                    </span>
                    <span>
                      Reserved: {gold(before.reserved)} →{" "}
                      {after ? gold(after.reserved) : "Unavailable"} G
                    </span>
                    <span>
                      Available: {gold(before.available)} →{" "}
                      {after ? gold(after.available) : "Unavailable"} G
                    </span>
                    <span>
                      Daily used: {gold(before.daily_spent)} →{" "}
                      {after ? gold(after.daily_spent) : "Unavailable"} G
                    </span>
                  </div>
                );
              })}
              {!wallets.length && (
                <p>Unavailable or no pre-existing affected wallet observed.</p>
              )}
              <h3>Ownership observations</h3>
              {t.before?.items
                .filter(
                  (i) =>
                    i.id === t.request.target ||
                    t.after?.items.some(
                      (a) => a.id === i.id && a.owner_id !== i.owner_id,
                    ),
                )
                .map((i) => (
                  <p key={i.id}>
                    {i.name}:{" "}
                    <b>
                      {i.owner_id} →{" "}
                      {t.after?.items.find((a) => a.id === i.id)?.owner_id ||
                        "Unavailable on page"}
                    </b>
                  </p>
                ))}
              <details>
                <summary>Request and HTTP result</summary>
                <Json value={{ request: t.request, reply: t.reply }} />
              </details>
              <details>
                <summary>
                  Persisted audit rows newly observed (not correlated)
                </summary>
                <Json
                  value={
                    t.before && t.after
                      ? t.after.audit.filter(
                          (a) => !t.before!.audit.some((b) => a.id === b.id),
                        )
                      : "Unavailable"
                  }
                />
              </details>
              {t.request.key && (
                <button
                  className="secondary"
                  onClick={() => onReplay(t.request)}
                >
                  Repeat exact request with same key <RefreshCw size={15} />
                </button>
              )}
              <p className="caption">
                Successful HTTP completion is an observation. Independent
                persisted-effect tests are required to assess idempotency and
                transactional invariants.
              </p>
            </>
          ) : (
            <Empty title="Every trade has a trace">
              Create an item, purchase a listing, or place a bid to inspect its
              request and observed effects.
            </Empty>
          )}
        </section>
      </div>
      <div className="section-head">
        <h2>Latest persisted audit page</h2>
        <Badge>Independent read</Badge>
      </div>
      <AuditTable data={data} />
    </>
  );
}

function SystemStatus({ data, error }: { data?: Snapshot; error: string }) {
  const [health, setHealth] = useState<string>("Not checked");
  const [runner, setRunner] = useState<string>("Not checked");
  async function check() {
    setHealth("Checking");
    setRunner("Checking");
    await Promise.allSettled([
      request("/healthz")
        .then((r) =>
          setHealth(`Healthy · HTTP ${r.status} · empty process response`),
        )
        .catch(() => setHealth("Unavailable")),
      request("/healthz", {}, "/lab")
        .then(() => setRunner("Healthy · isolated Testcontainers runner"))
        .catch(() => setRunner("Unavailable · start optional local harness")),
    ]);
  }
  const rows: [string, ReactNode][] = [
    ["Backend health-check", health],
    ["API base URL", API_BASE],
    ["Frontend version", "0.1.0"],
    ["Running environment", data?.environment || "Not checked"],
    [
      "Database readiness",
      error
        ? "Unavailable / stale snapshot"
        : data
          ? "Healthy · read-only query succeeded"
          : "Not checked",
    ],
    [
      "Database identity",
      data ? `${data.database}@${data.database_address}` : "Unavailable",
    ],
    ["PostgreSQL version", data?.database_version || "Unavailable"],
    ["Backend commit", data?.backend_commit || "Unavailable"],
    [
      "Mock oracle status",
      "Unsupported · backend does not expose oracle health",
    ],
    ["Isolated scenario harness", runner],
    ["Human approval", "PENDING_HUMAN_REVIEW"],
  ];
  return (
    <>
      <div className="section-head">
        <h2>Service diagnostics</h2>
        <button className="primary" onClick={() => void check()}>
          <Activity size={15} />
          Check services
        </button>
      </div>
      <div className="panel">
        <dl className="status-grid">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <section className="panel explanation">
        <Shield size={26} />
        <h2>Availability and correctness answer different questions.</h2>
        <p>
          /healthz confirms that the process can answer HTTP. A successful
          development snapshot confirms a database read at a point in time.
          Neither demonstrates transaction correctness. The Go integration tests
          independently inspect committed state after retries, competition and
          deliberately failed transactions.
        </p>
        <p>
          This application has no production authentication. Keep it local. A
          guild selector changes request input; it is not an authorization
          boundary.
        </p>
        <details>
          <summary>Collection totals and page limits</summary>
          <Json
            value={{
              counts: data?.counts,
              limit: data?.limit,
              offset: data?.offset,
            }}
          />
        </details>
      </section>
    </>
  );
}
