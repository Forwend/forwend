-- Tokens a profile or a store turns off (D-75, R-136). An enabled token is on until it is turned off here.

-- +goose Up
CREATE TABLE profile_tokens_off (
    profile_id uuid NOT NULL REFERENCES profiles (id),
    chain_id bigint NOT NULL,
    token_contract text NOT NULL,
    PRIMARY KEY (profile_id, chain_id, token_contract),
    FOREIGN KEY (chain_id, token_contract) REFERENCES tokens (chain_id, contract)
);

CREATE TABLE store_tokens_off (
    store_id uuid NOT NULL REFERENCES stores (id),
    chain_id bigint NOT NULL,
    token_contract text NOT NULL,
    PRIMARY KEY (store_id, chain_id, token_contract),
    FOREIGN KEY (chain_id, token_contract) REFERENCES tokens (chain_id, contract)
);

-- +goose Down
DROP TABLE store_tokens_off;
DROP TABLE profile_tokens_off;
