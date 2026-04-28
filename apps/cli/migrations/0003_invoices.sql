ALTER TABLE clients ADD COLUMN hourly_rate_cents INTEGER;
ALTER TABLE clients ADD COLUMN billing_name TEXT;
ALTER TABLE clients ADD COLUMN billing_email TEXT;
ALTER TABLE clients ADD COLUMN billing_address_line1 TEXT;
ALTER TABLE clients ADD COLUMN billing_address_line2 TEXT;
ALTER TABLE clients ADD COLUMN billing_city TEXT;
ALTER TABLE clients ADD COLUMN billing_state TEXT;
ALTER TABLE clients ADD COLUMN billing_postal_code TEXT;
ALTER TABLE clients ADD COLUMN billing_country TEXT;

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated')),
  issue_date TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  notes TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  client_id INTEGER NOT NULL,
  project_id INTEGER,
  generated_pdf_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS invoice_time_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  entry_id INTEGER NOT NULL,
  entry_date TEXT NOT NULL,
  note TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  hourly_rate_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (invoice_id, entry_id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  FOREIGN KEY (entry_id) REFERENCES entries(id)
);

CREATE TABLE IF NOT EXISTS invoice_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  expense_date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_project_id ON invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_invoice_time_items_invoice_id ON invoice_time_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_expenses_invoice_id ON invoice_expenses(invoice_id);
