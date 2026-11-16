-- ADR 0022, amended 2026-11-16: a client company's profile is its subject in the Adresar.
-- Each profile row becomes its company's subject: the subject with the same (country, IČO) is
-- linked and updated with the profile's values, otherwise one is created. The profile wins over
-- what the directory held, as it did for every reader before this step, so the values
-- getCompanyProfile returns are the ones they returned before.
--
-- Provenance: a value a register lookup filled is `register` (the IČ DPH VIES confirmed is `vies`);
-- a value she typed is `manual`, and a manual value is kept by a register refresh.
--
-- One statement (a DO block), so it runs in the same transaction as the migration that then drops
-- company_profiles. The subject links are derived from the profiles: every link is made again here.
DO $$
DECLARE
  p company_profiles%ROWTYPE;
  sid integer;
  linked_to integer;
  register_made boolean;
  v_legal text;
  v_address text;
  v_dic text;
  v_icdph text;
  v_vat text;
  src jsonb;
  existing_sources jsonb;
  existing_manual jsonb;
  manual jsonb;
BEGIN
  UPDATE subjects SET linked_company_id = NULL WHERE linked_company_id IS NOT NULL;

  FOR p IN SELECT * FROM company_profiles ORDER BY company_id LOOP
    register_made := p.register_source ~ '^(rpo|ruz|ares)';
    v_legal := NULLIF(btrim(p.legal_name), '');
    v_address := NULLIF(btrim(p.address), '');
    v_dic := NULLIF(btrim(p.dic), '');
    v_icdph := NULLIF(btrim(p.ic_dph), '');
    -- The VAT ID the app derives: IČ DPH for Slovakia, the DIČ for the Czech Republic.
    v_vat := CASE
      WHEN p.country = 'SK' THEN NULLIF(upper(regexp_replace(coalesce(v_icdph, ''), '\s', '', 'g')), '')
      ELSE NULLIF(upper(regexp_replace(coalesce(v_dic, ''), '\s', '', 'g')), '')
    END;

    src := '{}'::jsonb;
    IF v_legal IS NOT NULL THEN
      src := src || jsonb_build_object('legalName', CASE WHEN register_made THEN 'register' ELSE 'manual' END);
    END IF;
    IF v_address IS NOT NULL THEN
      src := src || jsonb_build_object('address', CASE WHEN register_made THEN 'register' ELSE 'manual' END);
    END IF;
    IF v_dic IS NOT NULL THEN
      src := src || jsonb_build_object('dic', CASE WHEN register_made THEN 'register' ELSE 'manual' END);
    END IF;
    IF v_icdph IS NOT NULL THEN
      src := src || jsonb_build_object('icDph', CASE WHEN p.register_source LIKE '%+vies' THEN 'vies' ELSE 'manual' END);
    END IF;
    manual := COALESCE((SELECT jsonb_agg(key) FROM jsonb_each_text(src) WHERE value = 'manual'), '[]'::jsonb);

    SELECT id, linked_company_id INTO sid, linked_to FROM subjects WHERE country = p.country AND ico = p.ico;
    IF sid IS NOT NULL AND linked_to IS NOT NULL THEN
      -- An earlier profile in this step holds the IČO: two companies with one IČO. Neither is
      -- guessed at; the second stays without a subject, and the warning names its company.
      RAISE WARNING 'company % not moved to the Adresar: its ICO is another company profile', p.company_id;
      CONTINUE;
    END IF;

    IF sid IS NULL THEN
      INSERT INTO subjects (
        country, ico, vat_id, legal_name, former_names_json, dic, ic_dph, address,
        register_status, sources_json, manual_fields_json, findings_json, linked_company_id,
        verified_at, last_seen_at, created_at, profile_register_source, profile_saved_at
      ) VALUES (
        p.country, p.ico, v_vat, v_legal, '[]', v_dic, v_icdph, v_address,
        'unknown', src::text, manual::text, '[]', p.company_id,
        NULL, p.saved_at, p.saved_at, p.register_source, p.saved_at
      );
    ELSE
      SELECT sources_json::jsonb, manual_fields_json::jsonb
        INTO existing_sources, existing_manual
        FROM subjects WHERE id = sid;
      UPDATE subjects SET
        linked_company_id = p.company_id,
        vat_id = COALESCE(v_vat, vat_id),
        legal_name = v_legal,
        address = v_address,
        dic = v_dic,
        ic_dph = v_icdph,
        -- What the profile does not say keeps its provenance; the four identity fields take the profile's.
        sources_json = ((existing_sources - 'legalName' - 'address' - 'dic' - 'icDph') || src)::text,
        manual_fields_json = COALESCE((
          SELECT jsonb_agg(f) FROM (
            SELECT value AS f FROM jsonb_array_elements_text(existing_manual)
              WHERE value NOT IN ('legalName', 'address', 'dic', 'icDph')
            UNION
            SELECT key FROM jsonb_each_text(src) WHERE value = 'manual'
          ) kept
        ), '[]'::jsonb)::text,
        profile_register_source = p.register_source,
        profile_saved_at = p.saved_at,
        last_seen_at = p.saved_at
      WHERE id = sid;
    END IF;
  END LOOP;

  -- No second copy is left to disagree with the profile (ADR 0022, amended), and no source is "profile".
  UPDATE subjects SET findings_json = COALESCE((
    SELECT jsonb_agg(f) FROM jsonb_array_elements(findings_json::jsonb) AS f WHERE f->>'kind' <> 'profile-disagrees'
  ), '[]'::jsonb)::text
  WHERE findings_json LIKE '%profile-disagrees%';

  UPDATE subjects SET sources_json = COALESCE((
    SELECT jsonb_object_agg(key, value) FROM jsonb_each_text(sources_json::jsonb) WHERE value <> 'profile'
  ), '{}'::jsonb)::text
  WHERE sources_json LIKE '%"profile"%';
END $$;
