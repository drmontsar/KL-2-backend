-- up
ALTER TABLE clinical.medication_catalog ADD COLUMN visible boolean NOT NULL DEFAULT true;
UPDATE clinical.medication_catalog SET visible = false
  WHERE synthetic AND code IN ('DEMO-001','DEMO-002','DEMO-003','DEMO-004');
ALTER TABLE forms.templates ADD COLUMN visible boolean NOT NULL DEFAULT true;
UPDATE forms.templates SET visible = false
  WHERE created_by IS NULL AND name IN (
    '[DEMO] General consent for admission and treatment',
    '[DEMO] Informed consent for surgery or procedure',
    '[DEMO] Anaesthesia consent', '[DEMO] Blood transfusion consent', '[DEMO] High-risk consent',
    '[DEMO] Cashless pre-authorisation request', '[DEMO] Enhancement request',
    '[DEMO] Pre-operative checklist', '[DEMO] Referral and transfer note',
    '[DEMO] LAMA / DAMA form', '[DEMO] Medical certificate', '[DEMO] Medico-legal case intimation'
  );
ALTER TABLE opd.diagnosis_catalog ADD COLUMN visible boolean NOT NULL DEFAULT true;
UPDATE opd.diagnosis_catalog SET visible = false WHERE synthetic AND code IN ('DEMO-DX-001','DEMO-DX-002','DEMO-DX-003');
ALTER TABLE opd.investigation_catalog ADD COLUMN visible boolean NOT NULL DEFAULT true;
UPDATE opd.investigation_catalog SET visible = false WHERE synthetic AND code IN ('DEMO-LAB-001','DEMO-LAB-002');

-- down
ALTER TABLE opd.investigation_catalog DROP COLUMN IF EXISTS visible;
ALTER TABLE opd.diagnosis_catalog DROP COLUMN IF EXISTS visible;
ALTER TABLE forms.templates DROP COLUMN IF EXISTS visible;
ALTER TABLE clinical.medication_catalog DROP COLUMN IF EXISTS visible;
