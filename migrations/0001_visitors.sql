-- Unique-visitor tables. A visitor is sha256(salt + IP + User-Agent); raw IPs are never stored.
--
-- Each table's primary key is what "unique" means for it, so every hit is a handful of
-- INSERT OR IGNOREs. Triggers bump `counters` only when a row is really new, so reading
-- counts never scans the visitor tables.

-- All-time unique visitors, with where we first saw them.
CREATE TABLE visitors (
  visitor    TEXT    PRIMARY KEY,
  country    TEXT    NOT NULL,      -- ISO 3166-1 alpha-2 from request.cf.country, 'XX' if unknown
  region     TEXT,
  city       TEXT,
  first_seen INTEGER NOT NULL       -- unix seconds
);

-- Unique visitors per month, site-wide. `ip` (sha256(salt + IP)) caps how many
-- distinct visitors one IP can add per month, so faking User-Agents can't inflate counts.
CREATE TABLE site_months (
  month   TEXT NOT NULL,            -- 'YYYY-MM' (UTC)
  visitor TEXT NOT NULL,
  ip      TEXT NOT NULL,
  country TEXT NOT NULL,
  PRIMARY KEY (month, visitor)
);
CREATE INDEX site_months_ip ON site_months (month, ip);

-- Unique visitors per page, all time and per month.
CREATE TABLE page_visitors (
  page    TEXT NOT NULL,
  visitor TEXT NOT NULL,
  PRIMARY KEY (page, visitor)
);
CREATE TABLE page_months (
  page    TEXT NOT NULL,
  month   TEXT NOT NULL,
  visitor TEXT NOT NULL,
  PRIMARY KEY (page, month, visitor)
);

-- Running totals. kind: 'site' | 'page' | 'country' | 'city'
--   key:    '' for site, the path for page, the ISO code for country,
--           'IE|Leinster|Dublin' for city
--   period: 'all' or 'YYYY-MM'
CREATE TABLE counters (
  kind   TEXT    NOT NULL,
  key    TEXT    NOT NULL,
  period TEXT    NOT NULL,
  n      INTEGER NOT NULL,
  PRIMARY KEY (kind, key, period)
);

CREATE TRIGGER visitors_new AFTER INSERT ON visitors BEGIN
  INSERT INTO counters VALUES ('site', '', 'all', 1)
    ON CONFLICT DO UPDATE SET n = n + 1;
  INSERT INTO counters VALUES ('country', NEW.country, 'all', 1)
    ON CONFLICT DO UPDATE SET n = n + 1;
  INSERT INTO counters
    SELECT 'city', NEW.country || '|' || COALESCE(NEW.region, '') || '|' || NEW.city, 'all', 1
    WHERE NEW.city IS NOT NULL
    ON CONFLICT DO UPDATE SET n = n + 1;
END;

CREATE TRIGGER site_months_new AFTER INSERT ON site_months BEGIN
  INSERT INTO counters VALUES ('site', '', NEW.month, 1)
    ON CONFLICT DO UPDATE SET n = n + 1;
  INSERT INTO counters VALUES ('country', NEW.country, NEW.month, 1)
    ON CONFLICT DO UPDATE SET n = n + 1;
END;

CREATE TRIGGER page_visitors_new AFTER INSERT ON page_visitors BEGIN
  INSERT INTO counters VALUES ('page', NEW.page, 'all', 1)
    ON CONFLICT DO UPDATE SET n = n + 1;
END;

CREATE TRIGGER page_months_new AFTER INSERT ON page_months BEGIN
  INSERT INTO counters VALUES ('page', NEW.page, NEW.month, 1)
    ON CONFLICT DO UPDATE SET n = n + 1;
END;
