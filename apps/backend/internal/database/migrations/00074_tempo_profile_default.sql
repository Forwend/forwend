-- +goose Up
INSERT INTO profile_tokens_off (profile_id, chain_id, token_contract)
SELECT p.id, t.chain_id, t.contract
FROM profiles p CROSS JOIN tokens t JOIN chains c ON c.chain_id = t.chain_id
WHERE t.chain_id = 42431 AND t.contract = '0x20c0000000000000000000006a37da5c996874be'
  AND NOT (t.enabled AND c.enabled)
ON CONFLICT DO NOTHING;

-- +goose StatementBegin
CREATE FUNCTION profile_tempo_default() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO profile_tokens_off (profile_id, chain_id, token_contract)
    SELECT NEW.id, chain_id, contract FROM tokens
    WHERE chain_id = 42431 AND contract = '0x20c0000000000000000000006a37da5c996874be';
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER profile_tempo_default AFTER INSERT ON profiles
    FOR EACH ROW EXECUTE FUNCTION profile_tempo_default();

-- +goose Down
DROP TRIGGER profile_tempo_default ON profiles;
DROP FUNCTION profile_tempo_default();
