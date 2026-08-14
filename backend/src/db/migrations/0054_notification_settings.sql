CREATE TABLE notification_settings (
  escalation_threshold_minutes INTEGER NOT NULL DEFAULT 20,
  max_escalations              INTEGER NOT NULL DEFAULT 3,
  vehicle_dark_critical        BOOLEAN NOT NULL DEFAULT false,
  critical_notification_roles  TEXT[] NOT NULL DEFAULT ARRAY['management', 'owner'],
  order_stall_hours            INTEGER NOT NULL DEFAULT 24,
  idle_hours                   INTEGER NOT NULL DEFAULT 2,
  delay_buffer_minutes         INTEGER NOT NULL DEFAULT 30,
  rain_probability_threshold   INTEGER NOT NULL DEFAULT 70,
  wind_speed_threshold_kmh     INTEGER NOT NULL DEFAULT 40,
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO notification_settings DEFAULT VALUES;
