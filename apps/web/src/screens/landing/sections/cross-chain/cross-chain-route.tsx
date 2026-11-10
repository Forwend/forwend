"use client";

import {
  Badge,
  BrandIcon,
  type BrandIconName,
  Money,
  PAYMENT_STATUS,
  StatusPill,
} from "@forwend/ui-web";
import { Check, LoaderCircle, Pause } from "lucide-react";
import { type FocusEvent, useEffect, useRef, useState } from "react";
import { MarkIcon } from "@/shared/components/chains/token-mark";
import {
  BLOCKCHAIN_ICONS,
  CROSS_CHAIN_TARGET,
  CROSS_CHAIN_TOKEN_ICONS,
} from "@/shared/constants/chains";
import { blockchainName, chainName } from "@/shared/lib/chains";
import { PAYMENT_EXAMPLE as example } from "../example-payment/constants/example-payment";
import {
  ROUTE_COUNT_MS,
  ROUTE_CYCLE_MS,
  ROUTE_PHASES,
  ROUTE_STEPS,
  ROUTE_TICK_MS,
  ROUTE_TIMES,
  ROUTE_TOKENS,
} from "./constants/cross-chain";
import styles from "./cross-chain.module.css";

const [, , , PAID_MS] = ROUTE_TIMES;
// The last frame: paid, with the whole amount in. The page renders it first, so it also serves no-JS and reduced motion.
const STILL_MS = PAID_MS + ROUTE_COUNT_MS;

interface Line {
  symbol: string;
  token: BrandIconName | undefined;
  chain: BrandIconName | undefined;
  network: string;
}

const TARGET: Line = {
  symbol: CROSS_CHAIN_TARGET.symbol,
  token: CROSS_CHAIN_TOKEN_ICONS[CROSS_CHAIN_TARGET.symbol],
  chain: BLOCKCHAIN_ICONS.base,
  network: chainName(CROSS_CHAIN_TARGET.chainId),
};

function phaseAt(ms: number) {
  return ROUTE_TIMES.filter((start) => ms >= start).length;
}

/** The share of the amount shown as arrived, in thousandths: it counts up fast, then settles. */
function arrivedAt(ms: number) {
  const t = Math.min(1, Math.max(0, (ms - PAID_MS) / ROUTE_COUNT_MS));
  return BigInt(Math.round(1000 * (1 - (1 - t) ** 3)));
}

function TokenLine({ token, chain, symbol, network }: Line) {
  return (
    <div className={styles.token}>
      <MarkIcon token={token} chain={chain} letter={symbol.slice(0, 1)} />
      <span>
        <strong>{symbol}</strong>
        <small>on {network}</small>
      </span>
    </div>
  );
}

function RouteStatus({ phase }: { phase: number }) {
  if (phase === ROUTE_PHASES.converting)
    return (
      <Badge>
        <LoaderCircle
          aria-hidden
          className="size-3.5 animate-[fw-spin_var(--fw-duration-slower)_linear_infinite]"
        />
        Converting
      </Badge>
    );
  const status = [
    PAYMENT_STATUS.open,
    // On its way to NEAR Intents: nothing has reached the invoice's Base address yet.
    PAYMENT_STATUS.open,
    PAYMENT_STATUS.detected,
    PAYMENT_STATUS.confirming,
    PAYMENT_STATUS.paid,
  ][phase];
  return status ? <StatusPill status={status} /> : null;
}

/**
 * One sample payment on its way: a token leaves the customer, NEAR Intents converts it and USDC on Base arrives. It
 * loops over the sample tokens while on screen, pauses under the pointer or focus, and stays on its last frame when
 * the visitor asks for reduced motion.
 */
export function CrossChainRoute() {
  const [run, setRun] = useState({ pick: 0, ms: STILL_MS });
  const [moving, setMoving] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const show = useRef<HTMLElement>(null);
  const paused = hovered || focused;

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: no-preference)");
    function sync() {
      setMoving(motion.matches);
      setRun((current) => ({ pick: current.pick, ms: motion.matches ? 0 : STILL_MS }));
    }
    sync();
    motion.addEventListener("change", sync);
    return () => motion.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const node = show.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry?.isIntersecting ?? false),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!moving || paused || !visible) return;
    const id = window.setInterval(() => {
      setRun(({ pick, ms }) =>
        ms + ROUTE_TICK_MS < ROUTE_CYCLE_MS
          ? { pick, ms: ms + ROUTE_TICK_MS }
          : { pick: (pick + 1) % ROUTE_TOKENS.length, ms: 0 },
      );
    }, ROUTE_TICK_MS);
    return () => window.clearInterval(id);
  }, [moving, paused, visible]);

  // A picked token plays at once, even under the pointer or focus that paused the route.
  function choose(pick: number) {
    setRun({ pick, ms: moving ? 0 : STILL_MS });
    setHovered(false);
    setFocused(false);
  }

  function resumeOutside(event: FocusEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
  }

  const sent = ROUTE_TOKENS[run.pick] ?? ROUTE_TOKENS[0];
  const sentLine = {
    symbol: sent.symbol,
    token: CROSS_CHAIN_TOKEN_ICONS[sent.symbol],
    chain: BLOCKCHAIN_ICONS[sent.blockchain],
    network: blockchainName(sent.blockchain),
  };
  const phase = phaseAt(run.ms);
  const arrived = (example.baseUnits * arrivedAt(run.ms)) / 1000n;
  const onBase = phase >= ROUTE_PHASES.confirming;

  return (
    <figure
      ref={show}
      aria-label="Example payment from another chain"
      className={styles.show}
      data-phase={phase}
      data-still={!moving || undefined}
      data-paused={(moving && paused) || undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={resumeOutside}
    >
      <div className={styles.tags}>
        <Badge>Example</Badge>
        <span className={styles.paused} aria-hidden>
          <Pause className="size-3" />
          Paused
        </span>
      </div>
      <div className={styles.route}>
        <div className={styles.card}>
          <span className={styles.kicker}>Your customer pays with</span>
          <div
            key={run.pick}
            className="motion-safe:animate-[fw-step-in_var(--fw-duration-base)_var(--fw-ease-out)]"
          >
            <TokenLine {...sentLine} />
          </div>
          <div className={styles.amount}>
            <Money
              baseUnits={sent.baseUnits}
              decimals={sent.decimals}
              fractionDigits={sent.fractionDigits}
              token={sent.symbol}
            />
          </div>
          <div className={styles.foot}>
            <span className={styles.picks}>
              {ROUTE_TOKENS.map((token, index) => (
                <button
                  key={token.symbol}
                  type="button"
                  aria-pressed={index === run.pick}
                  aria-label={`Pay with ${token.symbol} on ${blockchainName(token.blockchain)}`}
                  onClick={() => choose(index)}
                >
                  <MarkIcon
                    small
                    token={CROSS_CHAIN_TOKEN_ICONS[token.symbol]}
                    chain={BLOCKCHAIN_ICONS[token.blockchain]}
                    letter={token.symbol.slice(0, 1)}
                  />
                  {token.symbol}
                </button>
              ))}
            </span>
            <span>and more</span>
          </div>
        </div>
        <div className={styles.rail} aria-hidden>
          <i className={styles.fill} />
          <span className={styles.dot}>
            {onBase ? (
              <>
                {TARGET.token ? <BrandIcon name={TARGET.token} /> : null}
                <span>
                  <Money
                    baseUnits={example.baseUnits}
                    decimals={example.decimals}
                    token={example.symbol}
                  />
                </span>
              </>
            ) : (
              <>
                {sentLine.token ? <BrandIcon name={sentLine.token} /> : null}
                <span>
                  <Money
                    baseUnits={sent.baseUnits}
                    decimals={sent.decimals}
                    fractionDigits={sent.fractionDigits}
                    token={sent.symbol}
                  />
                </span>
              </>
            )}
          </span>
          <span className={styles.node}>
            <BrandIcon name="near" />
            {phase === ROUTE_PHASES.converting ? (
              <span
                className={`${styles.ring} animate-[fw-spin_var(--fw-duration-slower)_linear_infinite]`}
              />
            ) : null}
          </span>
          <span className={styles.caption}>
            <strong>NEAR Intents converts</strong>
            to {TARGET.symbol} on {TARGET.network}
          </span>
        </div>
        <div className={styles.card}>
          <span className={styles.kicker}>{example.recipient} receives</span>
          <TokenLine {...TARGET} />
          <div className={styles.amount} data-zero={arrived === 0n || undefined}>
            <Money
              baseUnits={arrived}
              decimals={example.decimals}
              fractionDigits={2}
              token={example.symbol}
            />
          </div>
          <div className={styles.foot}>
            <RouteStatus phase={phase} />
            <span>Invoice {example.invoice}</span>
          </div>
        </div>
      </div>
      <ol className={styles.steps}>
        {ROUTE_STEPS.map((step, index) => {
          const done = phase >= step.done;
          return (
            <li
              key={step.title}
              data-state={done ? "done" : phase >= step.from ? "now" : undefined}
            >
              <span className={styles.stepNumber}>
                {done ? <Check aria-hidden className="size-3.5" /> : index + 1}
              </span>
              <strong>{step.title}</strong>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
