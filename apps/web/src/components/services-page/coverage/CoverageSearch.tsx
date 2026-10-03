"use client";

import { memo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  Search,
  Users,
  XCircle,
} from "lucide-react";
import { useCoverageSearch } from "@/hooks/use-coverage";
import { COVERAGE_STATUS_LABEL, type CoverageSearchResult } from "@/lib/coverage/coverage-types";
import { RequestCoverageForm } from "./RequestCoverageForm";

type Props = {
  /** Opens the full city explorer for a matched result. */
  onOpenCity?: (citySlug: string) => void;
  /** Dark variant sits on the emerald/slate CitiesSection background. */
  variant?: "dark" | "light";
};

const RESULT_ICON = {
  CITY: MapPin,
  AREA: MapPin,
  PINCODE: Search,
  SOCIETY: Building2,
} as const;

const ResultRow = memo(function ResultRow({
  result,
  onOpenCity,
}: {
  result: CoverageSearchResult;
  onOpenCity?: (slug: string) => void;
}) {
  const Icon = RESULT_ICON[result.type];
  const statusTone =
    result.status === "AVAILABLE"
      ? "bg-emerald-100 text-emerald-700"
      : result.status === "LIMITED"
        ? "bg-amber-100 text-amber-700"
        : "bg-gray-200 text-gray-600";

  return (
    <button
      type="button"
      onClick={() => onOpenCity?.(result.citySlug)}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-emerald-50"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gray-100 text-gray-500">
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-bold text-gray-900">{result.label}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusTone}`}>
            {COVERAGE_STATUS_LABEL[result.status]}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-gray-500">{result.sublabel}</span>
        {result.covered ? (
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-600">
            <span className="flex items-center gap-1 font-medium text-emerald-700">
              <CheckCircle2 size={11} />
              {result.availableToday ? "Available Today" : "Available"}
            </span>
            {result.partnersNearby != null && (
              <span className="flex items-center gap-1">
                <Users size={11} /> {result.partnersNearby} partners nearby
              </span>
            )}
            {result.expectedArrivalMins != null && result.expectedArrivalMins > 0 && (
              <span className="flex items-center gap-1">
                <Clock size={11} /> ~{result.expectedArrivalMins} mins
              </span>
            )}
          </span>
        ) : (
          <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-600">
            <XCircle size={11} /> Coming Soon — request coverage below
          </span>
        )}
      </span>
      <ChevronRight size={16} className="shrink-0 text-gray-400" />
    </button>
  );
});

/** Level 8 — Real-Time Coverage Search: society, area, or pincode. */
export function CoverageSearch({ onOpenCity, variant = "dark" }: Props) {
  const [input, setInput] = useState("");
  const [showRequestForm, setShowRequestForm] = useState(false);
  const { data, isFetching, debouncedQuery } = useCoverageSearch(input);

  const results = data?.results ?? [];
  const hasQuery = debouncedQuery.length >= 2;
  const noMatches = hasQuery && !isFetching && results.length === 0;
  const isPin = /^\d+$/.test(debouncedQuery);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div
        className={`relative rounded-2xl ${
          variant === "dark" ? "bg-white shadow-2xl shadow-black/20" : "border border-gray-200 bg-white shadow-sm"
        }`}
      >
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Search size={18} className="shrink-0 text-emerald-600" />
          <input
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setShowRequestForm(false);
            }}
            placeholder="Check your society, area or pincode — e.g. DLF Phase 5, 122018"
            className="w-full bg-transparent text-sm font-medium text-gray-900 outline-none placeholder:text-gray-400"
            aria-label="Search coverage by society, area or pincode"
          />
          {isFetching && <Loader2 size={16} className="shrink-0 animate-spin text-gray-400" />}
        </div>

        {hasQuery && (
          <div className="border-t border-gray-100 px-2 py-2">
            {results.length > 0 && (
              <div className="max-h-72 space-y-0.5 overflow-y-auto">
                {results.map((r) => (
                  <ResultRow key={`${r.type}:${r.citySlug}:${r.label}`} result={r} onOpenCity={onOpenCity} />
                ))}
              </div>
            )}

            {noMatches && !showRequestForm && (
              <div className="flex flex-col items-center gap-2 px-4 py-5 text-center">
                <p className="text-sm font-bold text-gray-900">
                  {isPin ? `Pincode ${debouncedQuery}` : `“${debouncedQuery}”`} isn&apos;t covered yet
                </p>
                <p className="text-xs text-gray-500">
                  We&apos;re expanding every week — tell us where you are and we&apos;ll prioritise your area.
                </p>
                <button
                  type="button"
                  onClick={() => setShowRequestForm(true)}
                  className="mt-1 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white transition hover:bg-amber-600"
                >
                  Request Coverage
                </button>
              </div>
            )}

            {noMatches && showRequestForm && (
              <div className="p-3">
                <RequestCoverageForm
                  defaultArea={isPin ? "" : debouncedQuery}
                  defaultPincode={isPin ? debouncedQuery : ""}
                  onDone={() => {
                    setShowRequestForm(false);
                    setInput("");
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
