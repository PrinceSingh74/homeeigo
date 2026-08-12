"use client";

import Image from "next/image";
import { m as motion, useReducedMotion } from "framer-motion";
import {
  ArrowUpRight,
  Award,
  Calendar,
  Check,
  CheckCircle,
  ChevronRight,
  Crown,
  Edit,
  MapPin,
  Settings,
} from "lucide-react";
import {
  profileHeroShell,
  profilePanelPad,
} from "@/components/profile/profile-page-layout";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useProfileDerived } from "@/hooks/use-derived-selectors";
import { useMySubscription } from "@/hooks/use-subscription";
import { useCountUp } from "@/components/profile/use-count-up";
import { EditProfileModal } from "@/components/profile/EditProfileModal";
import { useAppStore } from "@/stores/app-store";

export function ProfileHeader() {
  const reduce = useReducedMotion();
  const openOverlay = useAppStore((s) => s.openOverlay);
  const { profileUser } = useProfileDerived();
  const completion = useCountUp(profileUser.profileCompletion, 1000, !reduce);
  const isPremium = useAppStore((s) => s.isPremium);
  const { data: mySub } = useMySubscription();
  const activePlan = mySub?.active ?? null;
  const premium = isPremium || activePlan !== null;
  const [editOpen, setEditOpen] = useState(false);

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={cn(profileHeroShell, profilePanelPad, "relative overflow-hidden sm:p-6 lg:p-8")}
    >
      {/* premium ambient glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 size-60 rounded-full bg-gradient-to-br from-emerald-500/20 via-teal-500/15 to-emerald-300/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-16 -left-12 size-44 rounded-full bg-gold/10 blur-3xl"
      />
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

      <div className="relative flex flex-col gap-6 lg:gap-7">
        {/* ── Identity ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1, type: "spring", damping: 11 }}
            className="relative mx-auto shrink-0 sm:mx-0"
          >
            <div className="rounded-full bg-gradient-to-tr from-emerald-500 via-teal-500 to-emerald-400 p-[3px] shadow-[0_10px_30px_rgb(16_185_129/0.35)]">
              <Image
                src={profileUser.avatar}
                alt={profileUser.name}
                width={120}
                height={120}
                sizes="(max-width: 639px) 88px, (max-width: 1023px) 104px, 120px"
                className="size-[88px] rounded-full border-2 border-surface object-cover sm:size-[104px] lg:size-[120px] dark:border-ink"
              />
            </div>
            <motion.span
              initial={reduce ? false : { opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.25, type: "spring", stiffness: 160, damping: 9 }}
              className="absolute bottom-0.5 right-0.5 grid size-7 place-items-center rounded-full border-[3px] border-surface bg-emerald-700 text-white shadow-[0_2px_8px_rgb(16_185_129/0.45)] dark:border-ink sm:size-8"
              role="img"
              aria-label="Verified account"
            >
              <Check size={15} strokeWidth={3} />
            </motion.span>
          </motion.div>

          <div className="min-w-0 flex-1 text-center sm:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2.5 sm:justify-start">
              <h1
                className="font-display font-extrabold tracking-tight text-content"
                style={{ fontSize: "clamp(1.4rem, 5vw, 1.85rem)" }}
              >
                {profileUser.name}
              </h1>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide",
                  premium
                    ? "bg-gradient-to-r from-amber-400/20 to-gold/20 text-amber-600 ring-1 ring-gold/40 dark:text-gold"
                    : "bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-500/25",
                )}
              >
                <Crown size={12} fill="currentColor" />
                {premium ? "Premium" : "Member"}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <MetaChip icon={<MapPin size={13} className="text-emerald-600" />}>
                {profileUser.location}
              </MetaChip>
              <MetaChip icon={<Calendar size={13} className="text-muted" />}>
                Since {profileUser.memberSince}
              </MetaChip>
            </div>
          </div>
        </div>

        {/* ── Stats ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-3">
          <StatCard
            icon={<CheckCircle size={16} />}
            iconBg="bg-emerald-600/12"
            iconColor="text-emerald-600"
            label="Profile Completion"
            value={`${completion}%`}
          >
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-600"
                initial={{ width: 0 }}
                animate={{ width: `${profileUser.profileCompletion}%` }}
                transition={{ duration: 1.4, delay: 0.3, ease: "easeOut" }}
              />
            </div>
          </StatCard>

          <StatCard
            icon={<Award size={16} />}
            iconBg="bg-success/12"
            iconColor="text-success"
            label="Referral Code"
            value={profileUser.referralCode ?? "—"}
            valueClass="font-mono"
            sub={`${profileUser.referralCount} friend${profileUser.referralCount === 1 ? "" : "s"} joined`}
          />

          <StatCard
            icon={<Crown size={16} fill="currentColor" />}
            iconBg="bg-gold/15"
            iconColor="text-gold"
            label="Membership"
            value={premium ? "Premium" : "Free"}
            sub={
              activePlan?.expiresAt
                ? `Active until ${new Date(activePlan.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
                : "Tap to upgrade"
            }
            onClick={() => openOverlay("premium")}
            highlight={!premium}
          />
        </div>

        {/* ── Actions ──────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-2.5 min-[480px]:grid-cols-3">
          <ProfileAction variant="primary" icon={<Edit size={16} />} onClick={() => setEditOpen(true)}>
            Edit Profile
          </ProfileAction>
          <ProfileAction icon={<MapPin size={16} />} onClick={() => openOverlay("location")}>
            Manage Addresses
          </ProfileAction>
          <ProfileAction icon={<Settings size={16} />} onClick={() => openOverlay("settings")}>
            Account Settings
          </ProfileAction>
        </div>
      </div>

      <EditProfileModal open={editOpen} onClose={() => setEditOpen(false)} />
    </motion.section>
  );
}

function MetaChip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas/60 px-2.5 py-1 text-[12px] font-medium text-content dark:bg-charcoal/40">
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

function StatCard({
  icon,
  iconBg,
  iconColor,
  label,
  value,
  valueClass,
  sub,
  children,
  onClick,
  highlight,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
  children?: React.ReactNode;
  onClick?: () => void;
  highlight?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className={cn("grid size-9 place-items-center rounded-xl", iconBg, iconColor)}>{icon}</span>
        {onClick && (
          <ArrowUpRight
            size={16}
            className={cn("transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5", highlight ? "text-emerald-700" : "text-muted")}
          />
        )}
      </div>
      <p className="mt-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={cn("mt-0.5 truncate font-display text-xl font-extrabold leading-tight text-content sm:text-2xl", valueClass)}>
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-[11px] font-medium text-muted">{sub}</p>}
      {children}
    </>
  );

  const base = cn(
    "group flex flex-col rounded-2xl border p-4 text-left transition duration-200",
    highlight
      ? "border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.08] to-teal-500/[0.04] hover:border-emerald-500/50 hover:shadow-[0_10px_28px_rgb(16_185_129/0.18)]"
      : "border-line bg-canvas/60 hover:border-emerald-500/30 hover:shadow-[0_8px_22px_rgb(16_185_129/0.10)] dark:bg-charcoal/40",
    onClick && "hover:-translate-y-0.5",
  );

  return onClick ? (
    <button type="button" onClick={onClick} className={base}>
      {body}
    </button>
  ) : (
    <div className={base}>{body}</div>
  );
}

function ProfileAction({
  children,
  icon,
  onClick,
  variant = "secondary",
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex min-h-12 w-full items-center justify-between gap-2 rounded-xl px-4 text-[13px] font-semibold transition duration-200 active:scale-[0.99] sm:text-sm",
        variant === "primary"
          ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-[0_6px_18px_rgb(16_185_129/0.28)] hover:-translate-y-0.5 hover:shadow-[0_10px_26px_rgb(16_185_129/0.38)]"
          : "border border-line bg-canvas/60 text-content hover:border-emerald-500/40 hover:bg-luxe dark:bg-charcoal/40 dark:hover:bg-emerald-600/10",
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", variant === "primary" ? "bg-white/20" : "bg-emerald-600/10 text-emerald-600")}>
          {icon}
        </span>
        <span className="truncate">{children}</span>
      </span>
      <ChevronRight size={16} className={cn("shrink-0 transition-transform group-hover:translate-x-0.5", variant === "primary" ? "text-white/80" : "text-muted")} />
    </button>
  );
}
