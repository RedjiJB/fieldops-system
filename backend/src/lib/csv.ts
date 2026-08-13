export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
};

// RFC 4180: quote a field if it contains a comma, quote, or newline;
// double any quotes inside it.
function escapeField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeField(c.header)).join(",");
  const lines = rows.map((row) => columns.map((c) => escapeField(c.value(row))).join(","));
  return [header, ...lines].join("\r\n") + "\r\n";
}
