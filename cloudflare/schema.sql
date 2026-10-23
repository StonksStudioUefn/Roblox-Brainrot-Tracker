-- Idempotente: se aplica a mano sobre producción (README, «Despliegue»).

CREATE TABLE IF NOT EXISTS games (
  universe_id INTEGER PRIMARY KEY,
  place_id INTEGER,
  name TEXT,
  creator TEXT,
  creator_verified INTEGER,      -- 0/1
  created TEXT,                  -- ISO de Roblox
  updated TEXT,
  genre TEXT,                    -- género antiguo (lo elige el creador; existe "Horror")
  genre_l1 TEXT,
  genre_l2 TEXT,
  max_players INTEGER,
  first_seen TEXT,               -- ISO "AAAA-MM-DDTHH:MMZ"
  horror INTEGER,                -- 0/1, calculado con la descripción (que no se guarda)
  horror_score INTEGER,
  horror_reasons TEXT,           -- JSON array de strings
  sources TEXT,                  -- JSON array: "rolimons", "explore", "search:<query>"
  tracked INTEGER DEFAULT 1,     -- 1 = se muestrea en cada pasada
  low_since TEXT,                -- fecha desde la que está por debajo de TRACK_MIN_PLAYERS
  meta_date TEXT,                -- último día en que se refrescaron meta + horror + votos
  sel INTEGER DEFAULT 0          -- 1 = seguido (muestras cada hora, votos, export); lo elige `select` cada día
);
-- En una base anterior a `sel`: ALTER TABLE games ADD COLUMN sel INTEGER DEFAULT 0;

-- Parcial (sel = 1): la lista de cada hora lee ~200 filas y solo escribe al cambiar la selección.
CREATE INDEX IF NOT EXISTS games_sel ON games (universe_id) WHERE sel = 1;

CREATE TABLE IF NOT EXISTS places (place_id INTEGER PRIMARY KEY, universe_id INTEGER);  -- caché Rolimons

CREATE TABLE IF NOT EXISTS samples (
  universe_id INTEGER, ts INTEGER,   -- ts = minutos desde epoch UTC
  playing INTEGER, visits INTEGER,
  PRIMARY KEY (universe_id, ts)
) WITHOUT ROWID;
-- Sin índice por ts: D1 cuenta una fila escrita más por índice (≈74.000 de 100.000 al día).
DROP INDEX IF EXISTS samples_ts;

CREATE TABLE IF NOT EXISTS daily (
  universe_id INTEGER, date TEXT,    -- "AAAA-MM-DD" UTC
  n INTEGER, median INTEGER, mean INTEGER, min INTEGER, max INTEGER,
  visits INTEGER, favorites INTEGER, up INTEGER, down INTEGER,
  PRIMARY KEY (universe_id, date)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS sort_hits (    -- en qué listas oficiales de Roblox sale cada juego
  universe_id INTEGER, date TEXT, sort_id TEXT, rank INTEGER,
  PRIMARY KEY (universe_id, date, sort_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);

-- Antes state.hist_agg: una fila con todos los juegos iba a pasar del tope de 2 MB por fila.
CREATE TABLE IF NOT EXISTS hist (
  universe_id INTEGER PRIMARY KEY,
  peak INTEGER, peak_date TEXT,      -- máximo de daily.max y su (primera) fecha
  days INTEGER, first_day TEXT,      -- filas en daily y la primera fecha
  favorites INTEGER, up INTEGER, down INTEGER,   -- últimos conocidos
  last_date TEXT                     -- última fecha incorporada (la poda de un año mira esto)
);
