"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import {
  Award,
  Calendar,
  Check,
  CheckCircle,
  ChevronRight,
  Crown,
  Edit,
  MapPin,
  Settings,
  Star,
} from "lucide-react";
import {
  profileHeroShell,
  profilePanelPad,
  profileStatsScroll,
} from "@/components/profile/profile-page-layout";
import { cn } from "@/lib/utils";
import { PROFILE_USER } from "@/lib/profile-dashboard";
import { useCountUp } from "@/components/profile/use-count-up";
import { useAppStore } from "@/stores/app-store";

export function ProfileHeader() {
  const reduce = useReducedMotion();
  const openOverlay = useAppStore((s) => s.openOverlay);
  const showToast = useAppStore((s) => s.showToast);
  const completion = useCountUp(PROFILE_USER.profileCompletion, 1000, !reduce);
  const isPremium = useAppStore((s) => s.isPremium);

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={cn(profileHeroShell, profilePanelPad, "sm:p-6 lg:p-8")}
    >
      <div className="flex flex-col gap-5 lg:gap-6 xl:gap-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1, type: "spring", damping: 10 }}
            className="relative mx-auto shrink-0 sm:mx-0"
          >
            <Image
              src={PROFILE_USER.avatar}
              alt={PROFILE_USER.name}
              width={120}
              height={120}
              sizes="(max-width: 639px) 80px, (max-width: 1023px) 96px, 120px"
              className="size-20 rounded-full border-[3px] border-primary object-cover shadow-[0_8px_24px_rgb(37_99_235/0.3)] sm:size-24 sm:border-4 lg:size-[120px]"
            />
            <motion.span
              initial={reduce ? false : { opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 150, damping: 8 }}
              className="absolute bottom-0 right-0 grid size-7 place-items-center rounded-full border-2 border-white bg-success text-white shadow-[0_2px_8px_rgb(16_185_129/0.4)] dark:border-ink sm:bottom-1 sm:right-1 sm:size-8 sm:border-[3px]"
              aria-label="Verified account"
            >
              <Check size={14} strokeWidth={3} className="sm:hidden" />
              <Check size={16} strokeWidth={3} className="hidden sm:block" />
            </motion.span>
          </motion.div>

          <div className="min-w-0 flex-1 text-center sm:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <h1
                className="font-display font-bold tracking-tight text-content"
                style={{ fontSize: "clamp(1.25rem, 4.5vw, 1.5rem)" }}
              >
                {PROFILE_USER.name}
              </h1>
              <Star size={14} className="text-gold" fill="currentColor" aria-hidden />
            </div>
            <p className="mt-0.5 text-[13px] font-medium text-violet sm:text-sm">
              {isPremium ? "Premium Member" : PROFILE_USER.status}
            </p>
            <div className="mt-2 flex flex-col gap-1 sm:mt-3 sm:gap-2">
              <p className="flex items-center justify-center gap-1.5 text-[12px] text-content sm:justify-start sm:text-sm">
                <MapPin size={13} className="shrink-0 text-primary" />
                <span className="truncate">{PROFILE_USER.location}</span>
              </p>
              <p className="flex items-center justify-center gap-1.5 text-[12px] text-muted sm:justify-start sm:text-sm">
                <Calendar size={13} className="shrink-0" />
                Member since {PROFILE_USER.memberSince}
              </p>
            </div>
          </div>
        </div>

        <div className={profileStatsScroll}>
          <StatBlock
            label="Profile Completion"
            value={`${completion}%`}
            icon={<CheckCircle size={14} className="text-primary" />}
          >
            <div className="mt-2 h-1.5 w-full min-w-[100px] max-w-[120px] overflow-hidden rounded-full bg-line">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-primary to-violet"
                initial={{ width: 0 }}
                animate={{ width: `${PROFILE_USER.profileCompletion}%` }}
                transition={{ duration: 1.5, delay: 0.3, ease: "easeOut" }}
              />
            </div>
          </StatBlock>
          <StatBlock
            label="AI Trust Score"
            value={`${PROFILE_USER.trustScore}/5`}
            icon={<Award size={14} className="text-success" />}
            sub="Excellent"
            subClass="text-success"
          />
          <StatBlock
            label="Membership"
            value={PROFILE_USER.membership}
            icon={<Crown size={14} className="text-gold" fill="currentColor" />}
            sub="Active"
            subClass="text-success"
          />
        </div>

        <div className="grid w-full grid-cols-1 gap-2 min-[400px]:grid-cols-3 sm:gap-3 xl:max-w-[240px] xl:grid-cols-1 xl:justify-self-end">
          <ProfileAction
            variant="primary"
            icon={<Edit size={16} />}
            onClick={() => showToast("Edit profile — coming soon", "info")}
          >
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
    </motion.section>
  );
}

function StatBlock({
  label,
  value,
  icon,
  sub,
  subClass,
  children,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  sub?: string;
  subClass?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex w-[min(42vw,140px)] shrink-0 snap-start flex-col items-center gap-1.5 text-center sm:w-auto sm:min-w-[100px] sm:shrink sm:snap-normal">
      <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted sm:text-[11px]">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span
        className="font-display font-bold leading-none tracking-tight text-content"
        style={{ fontSize: "clamp(1.25rem, 5vw, 1.75rem)" }}
      >
        {value}
      </span>
      {sub && <span className={cn("text-[11px] font-semibold sm:text-xs", subClass)}>{sub}</span>}
      {children}
    </div>
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
        "flex min-h-11 w-full items-center justify-between gap-2 rounded-[10px] px-4 text-[13px] font-semibold transition duration-200 sm:text-sm",
        variant === "primary"
          ? "border-[1.5px] border-primary text-primary hover:bg-[#EFF6FF] hover:shadow-[0_4px_12px_rgb(37_99_235/0.15)] dark:hover:bg-primary/10"
          : "border border-line bg-canvas text-content hover:border-primary hover:bg-luxe dark:bg-charcoal/50 dark:hover:bg-primary/12",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{children}</span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-muted" />
    </button>
  );
}
