import { useEffect, useRef, type ReactNode } from "react";
import {
  X,
  Coins,
  Shield,
  Gem,
  Sword,
  FlaskConical,
  Crown,
} from "lucide-react";
import { gold } from "./api";
import type { Item, Wallet } from "./contracts";

export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Money({ value }: { value: number }) {
  return (
    <span className="money">
      <Coins size={15} />
      {gold(value)} <small>G</small>
    </span>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <Gem size={30} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function WalletView({ wallet }: { wallet: Wallet }) {
  const percentage = wallet.gold ? (wallet.reserved / wallet.gold) * 100 : 0;
  return (
    <section className="wallet-card" aria-label="Guild treasury">
      <div className="eyebrow">
        <Shield size={15} /> Guild treasury
      </div>
      <div className="balance" data-testid="wallet-total">
        <Money value={wallet.gold} />
      </div>
      <p>Total gold = available + reserved</p>
      <div
        className="balance-bar"
        role="img"
        aria-label={`${gold(wallet.available)} available, ${gold(wallet.reserved)} reserved`}
      >
        <i style={{ width: `${100 - percentage}%` }} />
        <b style={{ width: `${percentage}%` }} />
      </div>
      <div className="split">
        <span>
          <i className="dot green" />
          Available
          <strong>
            <Money value={wallet.available} />
          </strong>
        </span>
        <span>
          <i className="dot amber" />
          Reserved
          <strong>
            <Money value={wallet.reserved} />
          </strong>
        </span>
      </div>
      <div className="wallet-foot">
        <span>
          Daily spending used <b>{gold(wallet.daily_spent)} G</b>
        </span>
        <span>
          Daily limit{" "}
          <b>
            {wallet.daily_limit ? `${gold(wallet.daily_limit)} G` : "Unlimited"}
          </b>
        </span>
      </div>
      <small>
        Daily spending resets on the next wallet mutation in UTC. A read can
        still show the previous spending day.
      </small>
    </section>
  );
}
export function Artifact({
  item,
  small = false,
}: {
  item: Pick<Item, "type" | "name">;
  small?: boolean;
}) {
  const Icon =
    item.type === "legendary"
      ? Crown
      : item.type === "rare"
        ? Sword
        : FlaskConical;
  return (
    <div
      className={`artifact ${item.type} ${small ? "small" : ""}`}
      aria-hidden="true"
    >
      <div className="artifact-ring" />
      <div className="artifact-diamond" />
      <Icon strokeWidth={1} className="artifact-icon" />
      <span className="rune rune-a">✦</span>
      <span className="rune rune-b">✧</span>
      <span className="artifact-caption">A E T H O R I A</span>
    </div>
  );
}
export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const before = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      before?.focus();
    };
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose} aria-label={title}>
      <div className="dialog-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Json({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}
