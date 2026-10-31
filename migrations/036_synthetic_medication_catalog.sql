-- up
CREATE TABLE clinical.medication_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  brand text NOT NULL,
  ingredient text NOT NULL,
  drug_class text NOT NULL,
  in_stock boolean NOT NULL DEFAULT true,
  synthetic boolean NOT NULL DEFAULT true CHECK (synthetic)
);
CREATE TABLE clinical.medication_catalog_allergens (
  medication_id uuid NOT NULL REFERENCES clinical.medication_catalog(id) ON DELETE CASCADE,
  allergen text NOT NULL,
  PRIMARY KEY (medication_id, allergen)
);
INSERT INTO clinical.medication_catalog (code, brand, ingredient, drug_class) VALUES
  ('DEMO-001', 'Demo Analgesic A', 'demo-molecule-a', 'demo-class-alpha'),
  ('DEMO-002', 'Demo Antibiotic B', 'demo-molecule-b', 'demo-class-beta'),
  ('DEMO-003', 'Demo Antibiotic C', 'demo-molecule-c', 'demo-class-beta'),
  ('DEMO-004', 'Demo Infusion D', 'demo-molecule-d', 'demo-class-delta');
INSERT INTO clinical.medication_catalog_allergens (medication_id, allergen)
SELECT id, ingredient FROM clinical.medication_catalog
UNION ALL SELECT id, drug_class FROM clinical.medication_catalog
UNION ALL SELECT id, 'demo-beta-allergy' FROM clinical.medication_catalog WHERE drug_class = 'demo-class-beta';
ALTER TABLE clinical.medication_schedules ADD COLUMN catalog_id uuid REFERENCES clinical.medication_catalog(id);

-- down
ALTER TABLE clinical.medication_schedules DROP COLUMN IF EXISTS catalog_id;
DROP TABLE IF EXISTS clinical.medication_catalog_allergens;
DROP TABLE IF EXISTS clinical.medication_catalog;
