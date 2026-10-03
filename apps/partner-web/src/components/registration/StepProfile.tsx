"use client";

type ProfileData = {
  dateOfBirth: string;
  gender: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

export function StepProfile({
  loading,
  initialValues,
  onSubmit,
}: {
  loading: boolean;
  initialValues?: Partial<ProfileData>;
  onSubmit: (data: ProfileData) => void;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onSubmit({
          dateOfBirth: String(fd.get("dateOfBirth") ?? ""),
          gender: String(fd.get("gender") ?? ""),
          emergencyContactName: String(fd.get("emergencyContactName") ?? ""),
          emergencyContactPhone: String(fd.get("emergencyContactPhone") ?? ""),
        });
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">Complete your profile</h2>
        <p className="text-sm text-partner-muted">Help us match you with the right jobs.</p>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Date of birth</span>
        <input
          name="dateOfBirth"
          type="date"
          required
          defaultValue={initialValues?.dateOfBirth ?? ""}
          className="w-full rounded-xl border border-partner-border bg-partner-surface px-3 py-2.5"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Gender</span>
        <select
          name="gender"
          required
          defaultValue={initialValues?.gender ?? ""}
          className="w-full rounded-xl border border-partner-border bg-partner-surface px-3 py-2.5"
        >
          <option value="">Select</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Emergency contact name</span>
        <input
          name="emergencyContactName"
          required
          defaultValue={initialValues?.emergencyContactName ?? ""}
          className="w-full rounded-xl border border-partner-border bg-partner-surface px-3 py-2.5"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Emergency contact phone</span>
        <input
          name="emergencyContactPhone"
          required
          defaultValue={initialValues?.emergencyContactPhone ?? ""}
          className="w-full rounded-xl border border-partner-border bg-partner-surface px-3 py-2.5"
        />
      </label>
      <button type="submit" disabled={loading} className="w-full rounded-xl bg-partner-primary py-3 font-semibold text-white disabled:opacity-60">
        {loading ? "Saving…" : "Save & Continue"}
      </button>
    </form>
  );
}
