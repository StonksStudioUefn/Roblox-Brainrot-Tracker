-- schema.sql — Esquema D1 de roblox-tracker (ver CONTRACT.md).
-- Idempotente: se puede ejecutar varias veces.
--   npx wrangler d1 execute roblox-tracker --remote --file=schema.sql
--   (o POST /api/admin/schema)

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
  meta_date TEXT                 -- último día en que se refrescaron meta + horror + votos
);

CREATE TABLE IF NOT EXISTS places (place_id INTEGER PRIMARY KEY, universe_id INTEGER);  -- caché Rolimons

CREATE TABLE IF NOT EXISTS samples (
  universe_id INTEGER, ts INTEGER,   -- ts = minutos desde epoch UTC
  playing INTEGER, visits INTEGER,
  PRIMARY KEY (universe_id, ts)
) WITHOUT ROWID;
-- SIN índice por ts (cambio respecto a la primera versión del contrato):
-- D1 cuenta una fila escrita más por cada índice, así que `samples_ts`
-- duplicaba las escrituras de muestras (≈18k inserciones + 18k borrados al
-- día pasaban a ≈74k, cerca del límite de 100k). Todas las consultas por
-- rango de ts se hacen recorriendo `games` y buscando por la clave primaria
-- (universe_id, ts), que lee solo las filas necesarias.
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

CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);  -- Telegram, cursor de búsqueda…
