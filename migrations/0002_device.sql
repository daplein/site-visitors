-- Mobile or desktop, from the User-Agent at the visit (the User-Agent itself isn't stored).
-- 'mobile' covers phones and tablets. Counted like countries: all time and per month.
ALTER TABLE visitors    ADD COLUMN device TEXT NOT NULL DEFAULT 'desktop';
ALTER TABLE site_months ADD COLUMN device TEXT NOT NULL DEFAULT 'desktop';

DROP TRIGGER visitors_new;
CREATE TRIGGER visitors_new AFTER INSERT ON visitors BEGIN
  INSERT INTO counters VALUES ('site', '', 'all', 1)
    ON CONFLICT DO UPDATE SET n = n + 1;
  INSERT INTO counters VALUES ('country', NEW.country, 'all', 1)
    ON CONFLICT DO UPDATE SET n = n + 1;
  INSERT INTO counters
    SELECT 'city', NEW.country || '|' || COALESCE(NEW.region, '') || '|' || NEW.city, 'all', 1
    WHERE NEW.city IS NOT NULL
    ON CONFLICT DO UPDATE SET n = n + 1;
  INSERT INTO counters VALUES ('device', NEW.device, 'all', 1)
    ON CONFLICT DO UPDATE SET n = n + 1;
END;

DROP TRIGGER site_months_new;
CREATE TRIGGER site_months_new AFTER INSERT ON site_months BEGIN
  INSERT INTO counters VALUES ('site', '', NEW.month, 1)
    ON CONFLICT DO UPDATE SET n = n + 1;
  INSERT INTO counters VALUES ('country', NEW.country, NEW.month, 1)
    ON CONFLICT DO UPDATE SET n = n + 1;
  INSERT INTO counters VALUES ('device', NEW.device, NEW.month, 1)
    ON CONFLICT DO UPDATE SET n = n + 1;
END;
