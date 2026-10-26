import Link from "next/link";
import { monthName } from "@/lib/time";

export function MonthNav({ year, month, now }: { year: number; month: number; now: Date }) {
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;
  const lastMonth = year === nowYear ? nowMonth : 12;
  const months = Array.from({ length: lastMonth }, (_, index) => lastMonth - index);
  return (
    <nav className="mb-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link href={`/${year - 1}/12`} className="rounded-full bg-chip px-3 py-1">
          {year - 1}
        </Link>
        <span className="num text-lg">{year}</span>
        {year < nowYear ? (
          <Link href={`/${year + 1}/${year + 1 === nowYear ? nowMonth : 12}`} className="rounded-full bg-chip px-3 py-1">
            {year + 1}
          </Link>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {months.map((item) => {
          const current = item === month;
          return (
            <Link
              key={item}
              href={`/${year}/${item}`}
              className={current ? "rounded-full bg-ink px-3 py-1 text-sm text-paper" : "rounded-full bg-chip px-3 py-1 text-sm"}
            >
              {monthName(item)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
