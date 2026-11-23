CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'donor' CHECK (role IN ('donor', 'staff', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS donors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  full_name VARCHAR(100) NOT NULL,
  phone VARCHAR(30),
  blood_type TEXT CHECK (blood_type IS NULL OR blood_type IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  date_of_birth DATE,
  city VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS donations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id UUID NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
  donated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  location VARCHAR(120),
  amount_ml INTEGER NOT NULL DEFAULT 450 CHECK (amount_ml BETWEEN 200 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS donations_donor_donated_at_idx ON donations (donor_id, donated_at DESC);
CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
