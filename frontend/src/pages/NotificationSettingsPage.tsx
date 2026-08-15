import { useEffect, useState } from "react";
import { api, CREW_ROLES, type NotificationSettings } from "../api/client";
import { useAuth } from "../context/AuthContext";

const fieldRowStyle = { display: "flex", flexDirection: "column" as const, gap: 4, marginBottom: 16 };
const labelStyle = { fontSize: 13, fontWeight: 600 };
const helpStyle = { fontSize: 12.5, color: "var(--color-text-muted)" };
const inputStyle = { width: 120, padding: "6px 8px" };
const checkboxRowStyle = { display: "flex", gap: 6, alignItems: "center" };

type FormState = {
  escalation_threshold_minutes: string;
  max_escalations: string;
  vehicle_dark_critical: boolean;
  critical_notification_roles: string[];
  order_stall_hours: string;
  idle_hours: string;
  delay_buffer_minutes: string;
  rain_probability_threshold: string;
  wind_speed_threshold_kmh: string;
  daily_overtime_hours: string;
  break_required_after_hours: string;
};

function toFormState(settings: NotificationSettings): FormState {
  return {
    escalation_threshold_minutes: String(settings.escalation_threshold_minutes),
    max_escalations: String(settings.max_escalations),
    vehicle_dark_critical: settings.vehicle_dark_critical,
    critical_notification_roles: settings.critical_notification_roles,
    order_stall_hours: String(settings.order_stall_hours),
    idle_hours: String(settings.idle_hours),
    delay_buffer_minutes: String(settings.delay_buffer_minutes),
    rain_probability_threshold: String(settings.rain_probability_threshold),
    wind_speed_threshold_kmh: String(settings.wind_speed_threshold_kmh),
    daily_overtime_hours: String(settings.daily_overtime_hours),
    break_required_after_hours: String(settings.break_required_after_hours),
  };
}

function NumberField({
  label,
  help,
  value,
  onChange,
  suffix,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
}) {
  return (
    <div style={fieldRowStyle}>
      <label style={labelStyle}>{label}</label>
      <p style={{ ...helpStyle, margin: 0 }}>{help}</p>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="number" min="1" style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)} />
        {suffix && <span style={helpStyle}>{suffix}</span>}
      </span>
    </div>
  );
}

export function NotificationSettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    api
      .notificationSettings()
      .then((s) => {
        setSettings(s);
        setForm(toFormState(s));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load notification settings"));
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div style={{ overflowY: "auto", flex: 1 }}>
        <section className="card" style={{ maxWidth: 640 }}>
          <h2>Notification Settings</h2>
          <p style={{ color: "var(--color-text-muted)" }}>Admin access required.</p>
        </section>
      </div>
    );
  }

  function toggleRole(role: string) {
    if (!form) return;
    const has = form.critical_notification_roles.includes(role);
    const next = has
      ? form.critical_notification_roles.filter((r) => r !== role)
      : [...form.critical_notification_roles, role];
    setForm({ ...form, critical_notification_roles: next });
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const positiveInt = (raw: string, label: string): number => {
        const n = Number(raw);
        if (!Number.isInteger(n) || n <= 0) throw new Error(`${label} must be a positive whole number`);
        return n;
      };
      if (form.critical_notification_roles.length === 0) {
        throw new Error("At least one role must be selected for critical notifications");
      }
      const patch = {
        escalation_threshold_minutes: positiveInt(form.escalation_threshold_minutes, "Escalation threshold"),
        max_escalations: positiveInt(form.max_escalations, "Max escalations"),
        vehicle_dark_critical: form.vehicle_dark_critical,
        critical_notification_roles: form.critical_notification_roles as NotificationSettings["critical_notification_roles"],
        order_stall_hours: positiveInt(form.order_stall_hours, "Order stall hours"),
        idle_hours: positiveInt(form.idle_hours, "Idle hours"),
        delay_buffer_minutes: positiveInt(form.delay_buffer_minutes, "Delay buffer"),
        rain_probability_threshold: positiveInt(form.rain_probability_threshold, "Rain probability threshold"),
        wind_speed_threshold_kmh: positiveInt(form.wind_speed_threshold_kmh, "Wind speed threshold"),
        daily_overtime_hours: positiveInt(form.daily_overtime_hours, "Daily overtime threshold"),
        break_required_after_hours: positiveInt(form.break_required_after_hours, "Break-required threshold"),
      };
      const updated = await api.updateNotificationSettings(patch);
      setSettings(updated);
      setForm(toFormState(updated));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <section className="card" style={{ maxWidth: 640 }}>
        <h2>Notification Settings</h2>
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          Tuning for the exceptions engine and the critical-notification delivery pipeline — previously hardcoded
          constants, now editable here and picked up by the next worker tick or notifier cron run, no redeploy
          needed.
        </p>

        {error && <div style={{ color: "var(--color-status-bad)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
        {saved && !error && <div style={{ color: "var(--color-status-good)", fontSize: 13, marginBottom: 12 }}>Saved.</div>}

        {!settings || !form ? (
          <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>
        ) : (
          <>
            <h3 style={{ fontSize: 14, marginTop: 24 }}>Escalation</h3>
            <NumberField
              label="Escalation threshold"
              help="How long a critical notification can sit unacknowledged before it's re-sent."
              value={form.escalation_threshold_minutes}
              onChange={(v) => setForm({ ...form, escalation_threshold_minutes: v })}
              suffix="minutes"
            />
            <NumberField
              label="Max escalations"
              help="How many times a notification re-sends before giving up (a pending confirmation also expires once this cap is hit with no response)."
              value={form.max_escalations}
              onChange={(v) => setForm({ ...form, max_escalations: v })}
              suffix="times"
            />

            <h3 style={{ fontSize: 14, marginTop: 24 }}>Vehicle-dark priority</h3>
            <div style={fieldRowStyle}>
              <p style={{ ...helpStyle, margin: 0 }}>
                A vehicle that was reporting location and has since gone quiet for 3+ hours. Off by default —
                routine, shows up in the digest only.
              </p>
              <label style={checkboxRowStyle}>
                <input
                  type="checkbox"
                  checked={form.vehicle_dark_critical}
                  onChange={(e) => setForm({ ...form, vehicle_dark_critical: e.target.checked })}
                />
                Page management instantly instead
              </label>
            </div>

            <h3 style={{ fontSize: 14, marginTop: 24 }}>Critical-notification roles</h3>
            <div style={fieldRowStyle}>
              <p style={{ ...helpStyle, margin: 0 }}>
                Which crew roles get paged on WhatsApp for a critical alert. At least one required.
              </p>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" as const }}>
                {CREW_ROLES.map((role) => (
                  <label key={role} style={checkboxRowStyle}>
                    <input
                      type="checkbox"
                      checked={form.critical_notification_roles.includes(role)}
                      onChange={() => toggleRole(role)}
                    />
                    {role}
                  </label>
                ))}
              </div>
            </div>

            <h3 style={{ fontSize: 14, marginTop: 24 }}>Exceptions engine thresholds</h3>
            <NumberField
              label="Order stall"
              help="An order sitting in 'requested' longer than this without advancing gets flagged."
              value={form.order_stall_hours}
              onChange={(v) => setForm({ ...form, order_stall_hours: v })}
              suffix="hours"
            />
            <NumberField
              label="Idle crew"
              help="Crew clocked in (or back from break) longer than this with no recorded site activity gets flagged as idle."
              value={form.idle_hours}
              onChange={(v) => setForm({ ...form, idle_hours: v })}
              suffix="hours"
            />
            <NumberField
              label="Delay buffer"
              help="How late a confirmed shift's start time can pass with no check-in before it's flagged."
              value={form.delay_buffer_minutes}
              onChange={(v) => setForm({ ...form, delay_buffer_minutes: v })}
              suffix="minutes"
            />
            <NumberField
              label="Rain probability"
              help="A job site with a confirmed shift today gets a weather flag at or above this rain chance."
              value={form.rain_probability_threshold}
              onChange={(v) => setForm({ ...form, rain_probability_threshold: v })}
              suffix="%"
            />
            <NumberField
              label="Wind speed"
              help="...or at or above this forecast wind speed."
              value={form.wind_speed_threshold_kmh}
              onChange={(v) => setForm({ ...form, wind_speed_threshold_kmh: v })}
              suffix="km/h"
            />

            <h3 style={{ fontSize: 14, marginTop: 24 }}>Overtime / break compliance</h3>
            <p style={{ ...helpStyle, margin: "0 0 12px" }}>
              Shown on the Timesheets page, not paged — a payroll-review flag, not an active-incident alert.
            </p>
            <NumberField
              label="Daily overtime"
              help="A shift (clock-in to clock-out span) longer than this gets flagged overtime."
              value={form.daily_overtime_hours}
              onChange={(v) => setForm({ ...form, daily_overtime_hours: v })}
              suffix="hours"
            />
            <NumberField
              label="Break required after"
              help="A shift longer than this with zero recorded break gets flagged missed break."
              value={form.break_required_after_hours}
              onChange={(v) => setForm({ ...form, break_required_after_hours: v })}
              suffix="hours"
            />

            <button className="btn-primary" onClick={save} disabled={saving} style={{ marginTop: 8 }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
