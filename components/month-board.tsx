"use client";

import { useMemo, useState } from "react";
import { Money } from "@/components/money";
import { PositionCard, type CardPosition } from "@/components/position-card";

export type PositionWire = {
  nftMint: string;
  pair: string;
  status: "open" | "closed";
  inRange: boolean | null;
  opened: string;
  daysLabel: string;
  deposited: string;
  costMicro: string | null;
  current: string | null;
  currentValueMicro: string | null;
  withdrawn: string | null;
  feesCollected: string;
  feesUnsold: string;
  feesSold: string;
  feeSaleMicro: string;
  profitMicro: string | null;
};

type SummaryWire = {
  realizedMicro: string | null;
  feeMicro: string;
  feeSaleMicro: string;
  principalMicro: string | null;
};

const profitFilters = [
  { id: "all", label: "All" },
  { id: "gain", label: "In profit" },
  { id: "loss", label: "At a loss" },
] as const;

type ProfitFilter = (typeof profitFilters)[number]["id"];

export function MonthBoard({ positions, summary, title }: { positions: PositionWire[]; summary: SummaryWire; title: string }) {
  const [profit, setProfit] = useState<ProfitFilter>("all");
  const [minCost, setMinCost] = useState("");
  const cards = useMemo(() => positions.map(hydrate), [positions]);
  const minCostMicro = dollarsToMicro(minCost);
  const shown = cards.filter((position) => matches(position, profit, minCostMicro));
  const filtering = profit !== "all" || minCost.trim() !== "";

  return (
    <>
      {positions.length > 0 ? (
        <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <p className="mb-2 text-sm text-muted">Profit</p>
            <div className="flex flex-wrap gap-2">
              {profitFilters.map((option) => {
                const selected = profit === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setProfit(option.id)}
                    className={selected ? "rounded-full bg-ink px-3 py-1 text-sm text-paper" : "rounded-full bg-chip px-3 py-1 text-sm"}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="text-sm text-muted">
            Min cost
            <input
              value={minCost}
              onChange={(event) => setMinCost(event.target.value)}
              inputMode="decimal"
              placeholder="USDC"
              className="num mt-2 block w-36 rounded-full border border-line bg-card px-3 py-1 text-ink"
            />
          </label>
          {filtering ? (
            <button
              type="button"
              onClick={() => {
                setProfit("all");
                setMinCost("");
              }}
              className="rounded-full bg-chip px-3 py-1 text-sm"
            >
              Clear
            </button>
          ) : null}
          <p className="pb-1 text-sm text-muted">
            {shown.length.toLocaleString("en-US")} of {positions.length.toLocaleString("en-US")}
            {minCostMicro === "invalid" ? " · Enter a USDC amount" : ""}
          </p>
        </div>
      ) : null}
      <section className="mb-6 grid gap-3 sm:grid-cols-4">
        <Summary label="Realized this month" value={<Money micro={summary.realizedMicro} signed />} />
        <Summary label="USDC fees" value={<Money micro={summary.feeMicro} />} />
        <Summary label="Fee sales" value={<Money micro={summary.feeSaleMicro} />} />
        <Summary label="Principal result" value={<Money micro={summary.principalMicro} signed />} />
      </section>
      <p className="mb-4 max-w-3xl text-sm text-muted">
        Realized profit is USDC fees collected, USDC received for fee tokens sold, and the result of principal withdrawn or sold, all dated in this month. Open positions still show their unrealized value on the row. When two positions pay the same stock, the oldest unsold fee is treated as sold first.
      </p>
      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-6 text-muted">
          {positions.length === 0 ? `No Raydium CLMM activity in ${title}.` : "No positions match these filters."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {shown.map((position) => (
            <PositionCard key={position.nftMint} position={position} />
          ))}
        </div>
      )}
    </>
  );
}

function Summary({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl">{value}</p>
    </div>
  );
}

function matches(position: CardPosition, profit: ProfitFilter, minCostMicro: bigint | null | "invalid") {
  if (profit === "gain" && (position.profitMicro == null || position.profitMicro <= 0n)) return false;
  if (profit === "loss" && (position.profitMicro == null || position.profitMicro >= 0n)) return false;
  if (typeof minCostMicro === "bigint" && (position.costMicro == null || position.costMicro < minCostMicro)) return false;
  return true;
}

function dollarsToMicro(value: string): bigint | null | "invalid" {
  const trimmed = value.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!trimmed) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return "invalid";
  const [whole, frac = ""] = trimmed.split(".");
  return BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}

function micro(value: string | null) {
  return value == null ? null : BigInt(value);
}

function hydrate(position: PositionWire): CardPosition {
  return {
    nftMint: position.nftMint,
    pair: position.pair,
    status: position.status,
    inRange: position.inRange,
    opened: position.opened,
    daysLabel: position.daysLabel,
    deposited: position.deposited,
    costMicro: micro(position.costMicro),
    current: position.current,
    currentValueMicro: micro(position.currentValueMicro),
    withdrawn: position.withdrawn,
    feesCollected: position.feesCollected,
    feesUnsold: position.feesUnsold,
    feesSold: position.feesSold,
    feeSaleMicro: BigInt(position.feeSaleMicro),
    profitMicro: micro(position.profitMicro),
  };
}
