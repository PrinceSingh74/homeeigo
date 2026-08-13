"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Mail, MessageSquare, RefreshCw, ShieldCheck, Smartphone, X } from "lucide-react";
import { useRequestStartOtpMutation } from "@/hooks/use-partner-data";
import { getErrorMessage, PartnerApiError } from "@/lib/api-error";

const OTP_LENGTH = 6;

type SentInfo = {
  alreadyVerified: boolean;
  channels: string[];
  sentTo: { email: string | null; phone: string | null };
  resendInSec: number;
  expiresInSec: number;
};

/**
 * Proof-of-presence gate for "Start job".
 *
 * Opening the dialog dispatches a 6-digit PIN to the CUSTOMER (in-app
 * notification, email, SMS). The partner asks the customer for the PIN at the
 * door and types it here — only then does `onStart(otp)` run. If the backend
 * says the booking was already verified (e.g. a retried start), we skip the
 * input entirely and start directly.
 */
export function StartJobOtpDialog({
  bookingId,
  customerName,
  onStart,
  onClose,
}: {
  bookingId: string;
  customerName: string;
  /** Performs the actual start call (coords + mutation live with the caller). */
  onStart: (otp?: string) => Promise<void>;
  onClose: () => void;
}) {
  const requestOtp = useRequestStartOtpMutation();

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [sent, setSent] = useState<SentInfo | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [expiresIn, setExpiresIn] = useState(0);
  const [shake, setShake] = useState(0);

  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const startedRef = useRef(false);
  const dispatchedRef = useRef(false);

  const dispatchPin = useCallback(async () => {
    setSendError(null);
    try {
      const data = await requestOtp.mutateAsync({ bookingId });
      setSent({
        alreadyVerified: data.alreadyVerified,
        channels: data.channels ?? [],
        sentTo: data.sentTo ?? { email: null, phone: null },
        resendInSec: data.resendInSec ?? 30,
        expiresInSec: data.expiresInSec ?? 600,
      });
      setResendIn(data.alreadyVerified ? 0 : data.resendInSec ?? 30);
      setExpiresIn(data.alreadyVerified ? 0 : data.expiresInSec ?? 600);
      setDigits(Array(OTP_LENGTH).fill(""));
      setVerifyError(null);
    } catch (error) {
      // A cooldown reply still means a valid PIN is already live — let the
      // partner type it instead of showing a dead end.
      if (error instanceof PartnerApiError && error.code === "RESEND_COOLDOWN") {
        setSent(
          (prev) =>
            prev ?? {
              alreadyVerified: false,
              channels: [],
              sentTo: { email: null, phone: null },
              resendInSec: 30,
              expiresInSec: 600,
            },
        );
        setResendIn(30);
      } else {
        setSendError(getErrorMessage(error));
      }
    }
  }, [bookingId, requestOtp]);

  /* Dispatch the PIN exactly once when the dialog opens (ref guards against
     React StrictMode double-running the effect and issuing two PINs). */
  useEffect(() => {
    if (dispatchedRef.current) return;
    dispatchedRef.current = true;
    void dispatchPin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Countdown tickers (resend cooldown + PIN expiry). */
  useEffect(() => {
    if (resendIn <= 0 && expiresIn <= 0) return;
    const timer = setInterval(() => {
      setResendIn((v) => (v > 0 ? v - 1 : 0));
      setExpiresIn((v) => (v > 0 ? v - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendIn > 0, expiresIn > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = useCallback(
    async (code?: string) => {
      if (verifying || startedRef.current) return;
      const otp = code ?? digits.join("");
      if (otp.length !== OTP_LENGTH) return;
      setVerifying(true);
      setVerifyError(null);
      try {
        await onStart(otp);
        startedRef.current = true;
        onClose();
      } catch (error) {
        setVerifyError(getErrorMessage(error));
        setShake((s) => s + 1);
        setDigits(Array(OTP_LENGTH).fill(""));
        inputsRef.current[0]?.focus();
      } finally {
        setVerifying(false);
      }
    },
    [digits, onClose, onStart, verifying],
  );

  /* Already verified (retry after network error) — start without a PIN. */
  useEffect(() => {
    if (!sent?.alreadyVerified || startedRef.current) return;
    startedRef.current = true;
    void onStart(undefined)
      .then(onClose)
      .catch((error) => {
        startedRef.current = false;
        setVerifyError(getErrorMessage(error));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sent?.alreadyVerified]);

  function setDigit(index: number, raw: string) {
    const value = raw.replace(/\D/g, "");
    if (!value) {
      setDigits((d) => d.map((v, i) => (i === index ? "" : v)));
      return;
    }
    // Paste / multi-char input: spread across the boxes. Focus + auto-submit
    // must run here in the event handler — never inside the state updater,
    // which React executes mid-render.
    const next = [...digits];
    const chars = value.slice(0, OTP_LENGTH - index).split("");
    chars.forEach((c, i) => {
      next[index + i] = c;
    });
    setDigits(next);
    const focusIdx = Math.min(index + chars.length, OTP_LENGTH - 1);
    inputsRef.current[focusIdx]?.focus();
    const code = next.join("");
    if (code.length === OTP_LENGTH) void submit(code);
  }

  function onKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
    if (e.key === "Enter") void submit();
  }

  const expiryLabel =
    expiresIn > 0
      ? `${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, "0")}`
      : null;

  const channelIcons = [
    { key: "app", Icon: MessageSquare, label: "In-app" },
    { key: "email", Icon: Mail, label: "Email" },
    { key: "sms", Icon: Smartphone, label: "SMS" },
  ].filter((c) => sent?.channels.includes(c.key));

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Customer verification"
      >
        <motion.div
          className="w-full max-w-md rounded-2xl border border-partner-line bg-partner-card p-6 shadow-2xl"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-partner-primary/15">
                <ShieldCheck className="h-6 w-6 text-partner-primary" />
              </div>
              <div>
                <h2 className="font-display text-base font-bold text-partner-text">
                  Customer verification
                </h2>
                <p className="text-xs text-partner-muted">Start PIN required to begin</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-partner-muted transition hover:bg-white/5 hover:text-partner-text"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {requestOtp.isPending && !sent ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="h-6 w-6 animate-spin text-partner-primary" />
              <p className="text-sm text-partner-muted">Sending PIN to {customerName}…</p>
            </div>
          ) : sendError ? (
            <div className="py-6">
              <p className="rounded-xl border border-partner-danger/30 bg-partner-danger/10 p-3 text-sm text-partner-danger">
                {sendError}
              </p>
              <button
                type="button"
                onClick={() => void dispatchPin()}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-partner-primary px-4 py-2.5 text-sm font-semibold text-white"
              >
                <RefreshCw className="h-4 w-4" />
                Try again
              </button>
            </div>
          ) : sent?.alreadyVerified ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="h-6 w-6 animate-spin text-partner-success" />
              <p className="text-sm text-partner-muted">Already verified — starting job…</p>
              {verifyError ? (
                <p className="text-sm text-partner-danger">{verifyError}</p>
              ) : null}
            </div>
          ) : (
            <>
              <p className="mt-4 text-sm leading-relaxed text-partner-text-secondary">
                Ask <span className="font-semibold text-partner-text">{customerName}</span> for
                the 6-digit PIN we just sent them
                {sent?.sentTo.email || sent?.sentTo.phone ? (
                  <>
                    {" "}
                    at{" "}
                    <span className="font-medium text-partner-text">
                      {[sent.sentTo.email, sent.sentTo.phone].filter(Boolean).join(" · ")}
                    </span>
                  </>
                ) : null}
                .
              </p>

              {channelIcons.length > 0 && (
                <div className="mt-3 flex items-center gap-2">
                  {channelIcons.map(({ key, Icon, label }) => (
                    <span
                      key={key}
                      className="flex items-center gap-1 rounded-full bg-partner-bg/80 px-2 py-1 text-[10px] font-semibold text-partner-muted"
                    >
                      <Icon className="h-3 w-3 text-partner-primary" />
                      {label}
                    </span>
                  ))}
                  {expiryLabel && (
                    <span className="ml-auto text-[11px] font-semibold tabular-nums text-partner-muted">
                      Expires in {expiryLabel}
                    </span>
                  )}
                </div>
              )}

              <motion.div
                key={shake}
                className="mt-5 flex justify-center gap-2"
                initial={shake > 0 ? { x: 0 } : false}
                animate={shake > 0 ? { x: [0, -8, 8, -6, 6, -3, 3, 0] } : undefined}
                transition={{ duration: 0.4 }}
              >
                {digits.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      inputsRef.current[i] = el;
                    }}
                    inputMode="numeric"
                    autoComplete={i === 0 ? "one-time-code" : "off"}
                    autoFocus={i === 0}
                    maxLength={OTP_LENGTH}
                    value={digit}
                    disabled={verifying}
                    onChange={(e) => setDigit(i, e.target.value)}
                    onKeyDown={(e) => onKeyDown(i, e)}
                    onFocus={(e) => e.target.select()}
                    className={`w-11 rounded-xl border bg-partner-bg text-center font-display text-xl font-bold text-partner-text outline-none transition focus:border-partner-primary focus:ring-2 focus:ring-partner-primary/30 disabled:opacity-50 ${
                      verifyError ? "border-partner-danger/60" : "border-partner-line"
                    }`}
                    style={{ height: "3.25rem" }}
                    aria-label={`PIN digit ${i + 1}`}
                  />
                ))}
              </motion.div>

              {verifyError && (
                <p className="mt-3 text-center text-sm font-medium text-partner-danger">
                  {verifyError}
                </p>
              )}

              <button
                type="button"
                disabled={verifying || digits.join("").length !== OTP_LENGTH}
                onClick={() => void submit()}
                className="partner-glow-btn mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-partner-primary px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
              >
                {verifying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying…
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" />
                    Verify &amp; start job
                  </>
                )}
              </button>

              <div className="mt-4 flex items-center justify-center gap-1 text-xs text-partner-muted">
                <span>Customer didn&apos;t get it?</span>
                <button
                  type="button"
                  disabled={resendIn > 0 || requestOtp.isPending}
                  onClick={() => void dispatchPin()}
                  className="font-semibold text-partner-primary transition disabled:opacity-50"
                >
                  {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend PIN"}
                </button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
