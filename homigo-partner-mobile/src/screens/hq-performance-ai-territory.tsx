import { Award, MapPinned, Navigation2, Trophy } from "lucide-react-native";
import { useState } from "react";
import { Linking } from "react-native";
import { KpiCard } from "@/components/KpiCard";
import { ProgressRow } from "@/components/HqUi";
import { Block, Grid, HqScreen, Loadable, NotAvailable } from "@/components/money/DataScreen";
import { AssistantChat, DensityZoneList, IntelMeta, SurgeZoneList } from "@/components/money/Intel";
import { PeriodEarnings } from "@/components/money/PeriodEarnings";
import { NoReviews, RatingBreakdown, ReplySheet, ReviewCard } from "@/components/money/Reviews";
import { Banner, Button, Card, EmptyState, KeyValue, ListRow, Pill, T } from "@/components/ui";
import {
  K,
  REVIEWS_PAGE_SIZE,
  useCareerQuery,
  useDashboardQuery,
  useDemandForecastQuery,
  useDensityQuery,
  useLifecycleQuery,
  useNudgesQuery,
  useRankingsQuery,
  useReviewsQuery,
  useRouteQuery,
  useScoreHistoryQuery,
  useScoreQuery,
  useSurgeQuery,
  useZoneRecommendationsQuery,
} from "@/hooks/money/queries";
import { confidencePercent, count, formatDay, formatDayTime, humanise, percent } from "@/lib/money-format";
import { pageOf } from "@/lib/money-series";
import { RouteSummary } from "@/screens/hq-work-earnings";
import type { PartnerReview } from "@/types/partner";

/**
 * The Performance, AI and Territory screens. Nothing here is worked out on the phone: no tips from
 * client-side thresholds, no templated "insights", no averages. A read the server has switched off
 * (`null`) is shown as "not available yet"; a screen whose only source is admin-only says it is
 * coming soon and shows no numbers.
 */

/* ------------------------------------------------------------ performance */

export function PerformanceReviewsScreen() {
  const [page, setPage] = useState(1);
  const [replyTo, setReplyTo] = useState<PartnerReview | null>(null);
  const reviews = useReviewsQuery(page);
  return (
    <HqScreen title="Reviews" subtitle="What customers said, and your replies." refresh={[K.reviews]}>
      <Loadable query={reviews} errorTitle="Could not load reviews" loadingLabel="Loading reviews…">
        {(r) => {
          const list = Array.isArray(r.reviews) ? r.reviews : [];
          const first = (r.page - 1) * REVIEWS_PAGE_SIZE + 1;
          const hasNext = r.page * REVIEWS_PAGE_SIZE < r.total;
          return (
            <>
              <RatingBreakdown breakdown={r.ratingBreakdown} total={r.total} />
              {list.length === 0 ? (
                <NoReviews />
              ) : (
                <>
                  {list.map((rev, i) => (
                    <ReviewCard key={rev.id} review={rev} index={i} onReply={setReplyTo} />
                  ))}
                  <T kind="small" numeric>{`Showing ${first}–${first + list.length - 1} of ${r.total}, newest first.`}</T>
                  {r.page > 1 ? <Button label="Newer reviews" variant="secondary" onPress={() => setPage((p) => Math.max(1, p - 1))} testID="reviews-prev" /> : null}
                  {hasNext ? <Button label="Older reviews" variant="secondary" onPress={() => setPage((p) => p + 1)} testID="reviews-next" /> : null}
                </>
              )}
            </>
          );
        }}
      </Loadable>
      <ReplySheet review={replyTo} onClose={() => setReplyTo(null)} />
    </HqScreen>
  );
}

const SCORE_COMPONENTS: Array<[key: "quality" | "reliability" | "completion" | "onTime" | "customerSatisfaction" | "compliance" | "safety", label: string]> = [
  ["quality", "Quality"],
  ["reliability", "Reliability"],
  ["completion", "Completion"],
  ["onTime", "On-time"],
  ["customerSatisfaction", "Customer satisfaction"],
  ["compliance", "Compliance"],
  ["safety", "Safety"],
];

export function PerformanceScorecardScreen() {
  const score = useScoreQuery();
  const history = useScoreHistoryQuery();
  const lifecycle = useLifecycleQuery();
  return (
    <HqScreen title="Score" subtitle="Calculated by HOMEEIGO. It cannot be edited on this device." refresh={[K.score, K.scoreHistory, K.lifecycle]}>
      <Loadable query={score} errorTitle="Could not load your score" loadingLabel="Loading your score…">
        {(d) => (
          <>
            <Grid>
              <KpiCard label="Score" value={d.overallScore == null ? "—" : `${Math.round(d.overallScore)}`} />
              <KpiCard label="Band" value={humanise(d.band)} />
            </Grid>
            {d.overallScore == null ? <Banner tone="info" message="There is not enough data yet for an overall score." /> : null}
            <Block title="What it is made of" caption={`Calculated ${formatDayTime(d.calculatedAt)} from ${d.sample?.completedJobs ?? 0} completed jobs, ${d.sample?.ratings ?? 0} ratings, ${d.sample?.arrivals ?? 0} arrivals and ${d.sample?.assignments ?? 0} assignments.`}>
              <Card>
                {SCORE_COMPONENTS.map(([key, label]) => {
                  const c = d.components?.[key];
                  return <KeyValue key={key} label={label} value={c?.value == null ? "Not enough data" : String(Math.round(c.value))} />;
                })}
              </Card>
            </Block>
            <Block title="Change over time">
              <Card>
                {(["7d", "30d", "90d"] as const).map((window) => {
                  const t = d.trends?.[window];
                  const text = !t || t.insufficient || t.delta == null ? "Not enough data" : `${t.delta > 0 ? "+" : t.delta < 0 ? "−" : ""}${Math.abs(Math.round(t.delta * 10) / 10)}`;
                  return <KeyValue key={window} label={`Last ${window.replace("d", " days")}`} value={text} />;
                })}
              </Card>
            </Block>
          </>
        )}
      </Loadable>

      <Block title="Lifecycle">
        <Loadable query={lifecycle} errorTitle="Could not load your account state" loadingCards={1}>
          {(l) => (
            <Card testID="score-lifecycle">
              <KeyValue label="Account state" value={humanise(l.lifecycleState)} />
              <KeyValue label="Availability" value={humanise(l.availability?.currentStatus)} />
              <KeyValue label="Can be offered jobs" value={l.dispatchEligible ? "Yes" : "No"} />
            </Card>
          )}
        </Loadable>
      </Block>

      <Block title="Why did my score change?">
        <Loadable query={history} errorTitle="Could not load your score history" loadingCards={1}>
          {(h) => {
            const latest = h.items?.[0];
            if (!latest) {
              return (
                <Card>
                  <EmptyState icon={Trophy} title="No score history yet" message="When your score is recalculated, the change and the reasons for it appear here." testID="score-history-empty" />
                </Card>
              );
            }
            const reasons = Array.isArray(latest.reasons) ? latest.reasons : [];
            return (
              <Card testID="score-latest-change">
                <KeyValue label="Change" value={`${latest.previousScore == null ? "—" : Math.round(latest.previousScore)} → ${latest.newScore == null ? "—" : Math.round(latest.newScore)}`} strong />
                <KeyValue label="When" value={formatDayTime(latest.calculatedAt)} />
                {reasons.length === 0 ? <T kind="small">The server recorded no reason for this change.</T> : null}
                {reasons.map((r, i) => (
                  <T key={`${r.code ?? r.component ?? "reason"}-${i}`} kind="body">
                    {r.detail}
                  </T>
                ))}
              </Card>
            );
          }}
        </Loadable>
      </Block>
    </HqScreen>
  );
}

export function PerformanceCareerScreen() {
  const career = useCareerQuery();
  return (
    <HqScreen title="Career" subtitle="Your level and what the next one needs." refresh={[K.career]}>
      <Loadable query={career} errorTitle="Could not load career progress" loadingLabel="Loading career progress…">
        {(d) => {
          const requirements = Array.isArray(d.requirements) ? d.requirements : [];
          const badges = Array.isArray(d.badges) ? d.badges : [];
          return (
            <>
              <Grid>
                {/* The level is shown as the server sends it (the device script looks for that exact value). */}
                <KpiCard label="Level" value={d.currentLevel} />
                <KpiCard label="Priority boost" value={d.benefitsActive ? `+${d.careerPriorityBoost}` : "Paused"} />
              </Grid>
              <Card>
                <KeyValue label="Status" value={humanise(d.qualificationState)} />
                {d.nextLevel ? <ProgressRow label={`Progress to ${d.nextLevel}`} pct={d.progressPct} /> : <T kind="small">You are at the highest level.</T>}
              </Card>
              <Block title="Requirements">
                <Card>
                  {requirements.length === 0 ? (
                    <T kind="small">The server lists no requirements for the next level.</T>
                  ) : (
                    requirements.map((r) => <KeyValue key={r.id} label={`${r.met ? "Done · " : ""}${r.label}`} value={`${r.current}/${r.target}`} />)
                  )}
                </Card>
              </Block>
              <Block title="Badges">
                <Card>
                  {badges.length === 0 ? (
                    <EmptyState icon={Award} title="No badges awarded yet" message="Badges HOMEEIGO awards you appear here with the reason." testID="career-badges-empty" />
                  ) : (
                    badges.map((b, i) => <ListRow key={b.code} icon={Award} tone="warning" title={b.label} subtitle={`${b.reason} · ${formatDay(b.awardedAt)}`} last={i === badges.length - 1} />)
                  )}
                </Card>
              </Block>
            </>
          );
        }}
      </Loadable>
    </HqScreen>
  );
}

export function PerformanceRankingsScreen() {
  const rankings = useRankingsQuery();
  return (
    <HqScreen title="Rankings" subtitle="Where you stand among active partners in your city." refresh={[K.rankings]}>
      <Loadable
        query={rankings}
        errorTitle="Could not load rankings"
        loadingLabel="Loading rankings…"
        whenNull={<NotAvailable icon={Trophy} title="No ranking yet" message="The server has no ranking for your account." testID="rankings-none" />}
      >
        {(r) => {
          const categories = Array.isArray(r.categoryRanks) ? r.categoryRanks : [];
          return (
            <>
              {/* The server has no separate area ranking: its area fields repeat the city values, so they are not shown. */}
              <Card testID="rankings-city">
                <KeyValue label={`City rank${r.city ? ` · ${r.city}` : ""}`} value={r.cityRank > 0 ? `#${r.cityRank} of ${r.cityTotal}` : "Not ranked"} strong />
                <KeyValue label="Ranking score" value={typeof r.compositeScore === "number" ? r.compositeScore.toFixed(1) : "—"} />
              </Card>
              {r.cityRank > 0 ? null : <T kind="small">Only approved, active partners are ranked.</T>}
              <Block title="By category">
                <Card>
                  {categories.length === 0 ? (
                    <T kind="small">The server sent no category rankings.</T>
                  ) : (
                    categories.map((c) => <KeyValue key={c.category} label={humanise(c.category)} value={c.rank > 0 && c.total > 0 ? `#${c.rank} of ${c.total}` : "Not ranked"} />)
                  )}
                </Card>
              </Block>
            </>
          );
        }}
      </Loadable>
    </HqScreen>
  );
}

/**
 * The partner's recorded rates, and — only when the server has that feature switched on — the
 * server's own suggestions. The canned tips this screen used to derive from thresholds on the phone
 * are gone.
 */
export function PerformanceQualityScreen() {
  const dashboard = useDashboardQuery();
  const nudges = useNudgesQuery();
  return (
    <HqScreen title="Quality" subtitle="Your recorded rates." refresh={[K.dashboard, K.intel]}>
      <Loadable query={dashboard} errorTitle="Could not load your rates" loadingLabel="Loading your rates…">
        {(d) => (
          <Card testID="quality-rates">
            <KeyValue label="Acceptance rate" value={percent(d.rates?.acceptanceRate)} />
            <KeyValue label="Completion rate" value={percent(d.rates?.completionRate)} />
            <KeyValue label="Response rate" value={percent(d.rates?.responseRate)} />
            <KeyValue label="On-time rate" value={percent(d.rates?.onTimeRate)} />
            <KeyValue label="Cancellation rate" value={percent(d.rates?.cancellationRate)} />
            <KeyValue label="Reviews received" value={count(d.counts?.totalReviews)} />
          </Card>
        )}
      </Loadable>
      <Block title="Suggestions">
        <Loadable
          query={nudges}
          errorTitle="Could not load suggestions"
          loadingCards={1}
          whenNull={<NotAvailable title="Not available yet" message="HOMEEIGO has not switched on performance suggestions for partner accounts." testID="quality-nudges-off" />}
        >
          {(n) =>
            n.state !== "OK" ? (
              <NotAvailable title="Not enough history yet" message="Suggestions appear once there is enough recent work to compare." testID="quality-nudges-insufficient" />
            ) : n.nudges.length === 0 ? (
              <NotAvailable title="No suggestions right now" message={`Nothing stood out in your last ${n.windowDays} days.`} testID="quality-nudges-none" />
            ) : (
              <>
                {n.nudges.map((nudge, i) => (
                  <Banner key={`${nudge.metric}-${i}`} tone={nudge.severity === "WARNING" ? "warning" : "info"} title={humanise(nudge.metric)} message={nudge.message} />
                ))}
                <T kind="small">{`Written by the server from your last ${n.windowDays} days.`}</T>
              </>
            )
          }
        </Loadable>
      </Block>
    </HqScreen>
  );
}

export function PerformanceAnalyticsScreen() {
  const dashboard = useDashboardQuery();
  return (
    <HqScreen title="Analytics" subtitle="Earnings by period, and your job rates." refresh={[K.earnings, K.dashboard]}>
      <PeriodEarnings />
      <Block title="Job rates">
        <Loadable query={dashboard} errorTitle="Could not load your rates" loadingCards={1}>
          {(d) => (
            <Card>
              <KeyValue label="Acceptance rate" value={percent(d.rates?.acceptanceRate)} />
              <KeyValue label="Completion rate" value={percent(d.rates?.completionRate)} />
              <KeyValue label="Jobs completed, all time" value={count(d.counts?.completedLifetime)} />
            </Card>
          )}
        </Loadable>
      </Block>
    </HqScreen>
  );
}

/* --------------------------------------------------------------------- AI */

export function AiAssistantScreen() {
  return (
    <HqScreen title="AI Assistant" subtitle="Ask a question about your work.">
      <AssistantChat />
    </HqScreen>
  );
}

const FORECAST_PAGE = 12;

export function AiDemandForecastScreen() {
  const forecast = useDemandForecastQuery();
  const [shown, setShown] = useState(FORECAST_PAGE);
  return (
    <HqScreen title="Demand Forecast" subtitle="Expected bookings by zone and hour." refresh={[K.demand]}>
      <Loadable query={forecast} errorTitle="Could not load the demand forecast" loadingLabel="Loading the demand forecast…">
        {(f) => {
          if (!f.available) {
            return <NotAvailable title="No forecast right now" message={f.reason || "The forecast source did not answer."} testID="demand-unavailable" />;
          }
          const d = f.data;
          if (d.stale) {
            return (
              <Banner
                tone="warning"
                title="The forecast is out of date"
                message={`The latest forecast covers ${d.forecastWindow?.from ? formatDayTime(d.forecastWindow.from) : "—"} to ${d.forecastWindow?.to ? formatDayTime(d.forecastWindow.to) : "—"}${typeof d.expiredByHours === "number" ? `, which ended about ${Math.round(d.expiredByHours)} hours ago` : ""}. It is not shown, because it does not describe the coming hours.`}
                testID="demand-stale"
              />
            );
          }
          const points = Array.isArray(d.points) ? d.points : [];
          const { visible, hidden } = pageOf(points, shown);
          return (
            <>
              <IntelMeta freshness={f.freshness} generatedAt={f.generatedAt} confidence={f.confidence} />
              <Card>
                <KeyValue label={`Bookings expected, next ${d.horizonHours} hours, all zones`} value={String(Math.round(d.totalPredicted))} strong />
              </Card>
              <Block title="By zone and hour">
                <Card>
                  {points.length === 0 ? (
                    <T kind="small">The forecast has no zone rows.</T>
                  ) : (
                    visible.map((p, i) => (
                      <ListRow
                        key={`${p.zone_id}-${p.hour}-${i}`}
                        title={`Zone ${p.zone_id}`}
                        subtitle={`${formatDayTime(p.hour)} · range ${p.lo.toFixed(1)}–${p.hi.toFixed(1)}`}
                        value={p.predicted.toFixed(1)}
                        last={i === visible.length - 1 && hidden === 0}
                      />
                    ))
                  )}
                  {hidden > 0 ? <Button label={`Show ${Math.min(FORECAST_PAGE, hidden)} more`} variant="quiet" onPress={() => setShown((n) => n + FORECAST_PAGE)} /> : null}
                </Card>
              </Block>
              {(d.limitations ?? []).map((line) => (
                <T key={line} kind="small">
                  {line}
                </T>
              ))}
            </>
          );
        }}
      </Loadable>
    </HqScreen>
  );
}

export function AiRouteScreen() {
  const route = useRouteQuery();
  return (
    <HqScreen title="Route AI" subtitle="The order to visit the jobs you hold." refresh={[K.route]}>
      <Loadable query={route} errorTitle="Could not work out a route" loadingLabel="Working out your route…">
        {(r) => <RouteSummary route={r} />}
      </Loadable>
    </HqScreen>
  );
}

const SURGE_CAPTION = "The multiplier is the server's estimate of demand pressure in a zone. It is not a promise of higher pay.";

export function AiIntelligenceScreen() {
  const surge = useSurgeQuery();
  const zones = useZoneRecommendationsQuery();
  return (
    <HqScreen title="Growth Advisor" subtitle="Where demand is building." refresh={[K.surge, K.intel]}>
      <Block title="Top surge zones" caption={SURGE_CAPTION}>
        <Loadable query={surge} errorTitle="Could not load surge zones" loadingLabel="Loading surge zones…" loadingCards={1}>
          {(s) => (
            <>
              <IntelMeta freshness={s.freshness} generatedAt={s.generatedAt} confidence={s.confidence} />
              <SurgeZoneList zones={Array.isArray(s.data) ? s.data : []} />
            </>
          )}
        </Loadable>
      </Block>
      <Block title="Recommended zones for you">
        <Loadable
          query={zones}
          errorTitle="Could not load zone recommendations"
          loadingCards={1}
          whenNull={<NotAvailable icon={MapPinned} title="Not available yet" message="HOMEEIGO has not switched on zone recommendations for partner accounts." testID="zones-off" />}
        >
          {(z) =>
            z.state !== "OK" || z.recommendations.length === 0 ? (
              <NotAvailable icon={MapPinned} title="No recommendations right now" message="The server could not rank zones for you at the moment." testID="zones-none" />
            ) : (
              <Card testID="zones-list">
                {z.recommendations.map((rec, i) => {
                  const sure = confidencePercent(rec.confidence);
                  return (
                    <ListRow
                      key={rec.zoneId}
                      icon={MapPinned}
                      title={`${rec.rank}. ${rec.name}${rec.city ? ` · ${rec.city}` : ""}`}
                      subtitle={`${rec.coverage > 0 ? `Score ${Math.round(rec.score)} of 100` : "Not enough data to score"}${sure ? ` · confidence ${sure}` : ""}${typeof rec.evidence?.distanceKm === "number" ? ` · ${rec.evidence.distanceKm.toFixed(1)} km away` : ""}`}
                      last={i === z.recommendations.length - 1}
                    />
                  );
                })}
              </Card>
            )
          }
        </Loadable>
      </Block>
    </HqScreen>
  );
}

/* --------------------------------------------------------------- territory */

export function TerritoryNavigationScreen() {
  const route = useRouteQuery();
  return (
    <HqScreen title="Navigation" subtitle="Open directions to each job you hold." refresh={[K.route]}>
      <Loadable query={route} errorTitle="Could not load your stops" loadingLabel="Loading your stops…">
        {(r) => {
          const sequence = Array.isArray(r.sequence) ? r.sequence : [];
          if (sequence.length === 0) {
            return (
              <Card>
                <EmptyState icon={Navigation2} title="No stops right now" message="When you hold an active job, its directions appear here." testID="navigation-empty" />
              </Card>
            );
          }
          return (
            <Card>
              {sequence.map((s, i) => (
                <ListRow
                  key={`${s.bookingId}-${s.order}`}
                  icon={Navigation2}
                  title={`Stop ${s.order}`}
                  subtitle={`Open in Google Maps · about ${Math.round(s.cumulativeEtaMin)} min from now`}
                  onPress={() => void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`)}
                  last={i === sequence.length - 1}
                />
              ))}
            </Card>
          );
        }}
      </Loadable>
    </HqScreen>
  );
}

/** The route id says "heatmap"; what the server has is a list of zones with a surge estimate, shown as that. */
export function TerritoryHeatmapScreen() {
  const surge = useSurgeQuery();
  return (
    <HqScreen title="Surge zones" subtitle="Demand pressure by zone, highest first." refresh={[K.surge]}>
      <Loadable query={surge} errorTitle="Could not load surge zones" loadingLabel="Loading surge zones…">
        {(s) => (
          <>
            <IntelMeta freshness={s.freshness} generatedAt={s.generatedAt} confidence={s.confidence} />
            <SurgeZoneList zones={Array.isArray(s.data) ? s.data : []} />
            <T kind="small">{SURGE_CAPTION}</T>
          </>
        )}
      </Loadable>
    </HqScreen>
  );
}

export function TerritoryCoverageScreen() {
  const density = useDensityQuery();
  return (
    <HqScreen title="Coverage areas" subtitle="How many partners are in each zone." refresh={[K.density]}>
      <Loadable query={density} errorTitle="Could not load coverage areas" loadingLabel="Loading coverage areas…">
        {(d) => (
          <>
            <IntelMeta freshness={d.freshness} generatedAt={d.generatedAt} confidence={d.confidence} />
            <DensityZoneList zones={Array.isArray(d.data) ? d.data : []} />
            <T kind="small">The number on the right is partners located in the zone.</T>
          </>
        )}
      </Loadable>
    </HqScreen>
  );
}

/**
 * Zone scoring (`/api/geo-intel/zone-scoring`) is admin-only on the server, so there is nothing a
 * partner's phone can read for this screen. It is a planned, inert card — no call, no error state.
 */
export function TerritoryAnalyticsScreen() {
  return (
    <HqScreen title="Territory Analytics" subtitle="Zone scores for your territory.">
      <Card testID="territory-analytics-coming-soon">
        <EmptyState icon={MapPinned} title="Coming soon" message="Zone scores are not available to partner accounts yet. Surge zones and coverage areas are available now from the Territory menu." />
        <Pill label="Planned" />
      </Card>
    </HqScreen>
  );
}
