-- A merchant profile's team (R-138, D-93). The owner, profiles.user_id, has every permission and is never a member.

-- +goose Up
CREATE TABLE profile_members (
    profile_id uuid NOT NULL REFERENCES profiles (id),
    user_id uuid NOT NULL REFERENCES users (id),
    role text NOT NULL CHECK (role IN ('admin', 'developer', 'finance')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, user_id)
);
CREATE INDEX profile_members_user ON profile_members (user_id);

-- A Developer's or Finance member's stores; an Admin reaches every store.
CREATE TABLE member_stores (
    profile_id uuid NOT NULL,
    user_id uuid NOT NULL,
    store_id uuid NOT NULL,
    PRIMARY KEY (profile_id, user_id, store_id),
    FOREIGN KEY (profile_id, user_id) REFERENCES profile_members (profile_id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (store_id, profile_id) REFERENCES stores (id, profile_id)
);

-- +goose StatementBegin
CREATE FUNCTION profile_members_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = NEW.profile_id AND kind = 'merchant' AND user_id <> NEW.user_id) THEN
        RAISE EXCEPTION 'only a merchant profile has members, and its owner is not one';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER profile_members_check BEFORE INSERT OR UPDATE ON profile_members FOR EACH ROW
    EXECUTE FUNCTION profile_members_check();

-- +goose Down
DROP TABLE member_stores;
DROP TABLE profile_members;
DROP FUNCTION profile_members_check();
