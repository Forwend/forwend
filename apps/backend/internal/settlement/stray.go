package settlement

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"maps"
	"math/big"
	"slices"
	"strings"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Money an invoice option doesn't take (D-33, D-118): another token sent to its receive address on its chain, or any
// token sent to that address on another chain. The ledger never books it. The receiver's recover returns it, but only
// where the factory, its receiver code and the refund authority there are ours; otherwise support says it can't.

var (
	transferTopic     = crypto.Keccak256Hash([]byte("Transfer(address,address,uint256)"))
	recoveredTopic    = crypto.Keccak256Hash([]byte("Recovered(bytes32,address,address,uint256)"))
	recoverSelector   = selector(recoverSignature)
	balanceOfSelector = selector("balanceOf(address)")
	// A Safe on another chain is ours only with the same singleton (its slot 0), owners, threshold and modules.
	ownersSelector    = selector("getOwners()")
	thresholdSelector = selector("getThreshold()")
	modulesSelector   = append(selector("getModulesPaginated(address,uint256)"),
		append(common.LeftPadBytes([]byte{1}, 32), common.LeftPadBytes([]byte{10}, 32)...)...)
)

const recoverSignature = "recover(address,address,uint256)"

var (
	ErrCantReturn       = errors.New("this money can't be returned now")
	ErrRecoveryQueued   = errors.New("a recover for this transfer was printed already")
	ErrNoRecoveryQueued = errors.New("no recover is printed for that transaction")
	ErrRecoverySent     = errors.New("a matching recover is on chain: it may be this one, so the lock stays")
	ErrNotFinal         = errors.New("the transfer isn't final yet: try again in a few minutes")
	// Arc logs every USDC movement again from this system address in 18 decimals (watcher/arc.go); its twin, or the
	// native send it stands for, isn't a token another contract holds.
	arcEmitter = common.HexToAddress("0xfffffffffffffffffffffffffffffffffffffffe")
)

// Stray is one transfer to a receive address that isn't its invoice option's money.
type Stray struct {
	TxHash      string
	LogIndex    uint
	BlockNumber uint64
	BlockHash   common.Hash
	ChainID     uint64 // where it was sent
	Option      CaseOption
	Token, From common.Address
	Amount      *big.Int
	Symbol      string // from our token list; "" for a token Forwend doesn't take there
	Decimals    int
}

// Recovery is the calls that return a stray transfer.
type Recovery struct {
	To        common.Address
	Authority common.Address
	Calls     []Call
	Warnings  []string
}

// FindStrays reads the transaction on every chain in clients and keeps its transfers to an invoice option's receive
// address other than that option's own token on its own chain, which the ledger books as a payment. A chain whose
// RPC fails stops the search: a missed transfer would read as no case.
func FindStrays(ctx context.Context, db *pgxpool.Pool, clients map[uint64]*ethclient.Client, txHash string) ([]Stray, error) {
	hash := common.HexToHash(txHash)
	var strays []Stray
	for _, chainID := range slices.Sorted(maps.Keys(clients)) {
		receipt, err := clients[chainID].TransactionReceipt(ctx, hash)
		if errors.Is(err, ethereum.NotFound) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("chain %d: read the transaction: %w", chainID, err)
		}
		if receipt.Status != 1 {
			continue
		}
		for _, l := range receipt.Logs {
			if len(l.Topics) != 3 || l.Topics[0] != transferTopic || len(l.Data) != 32 || l.Address == arcEmitter {
				continue
			}
			amount := new(big.Int).SetBytes(l.Data)
			if amount.Sign() == 0 {
				continue
			}
			to := strings.ToLower(common.BytesToAddress(l.Topics[2].Bytes()).Hex())
			rows, err := db.Query(ctx, `SELECT i.id, i.chain_id, coalesce(t.symbol, ''), coalesce(t.decimals, 0)
				FROM invoices i LEFT JOIN tokens t ON t.chain_id = $2 AND t.contract = $3
				WHERE i.receive_address = $1 AND NOT (i.chain_id = $2 AND i.token_contract = $3) ORDER BY i.id`,
				to, chainID, strings.ToLower(l.Address.Hex()))
			if err != nil {
				return nil, fmt.Errorf("find the invoice: %w", err)
			}
			found, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Stray, error) {
				s := Stray{TxHash: strings.ToLower(txHash), LogIndex: l.Index, BlockNumber: l.BlockNumber, BlockHash: l.BlockHash, ChainID: chainID,
					Token: l.Address, From: common.BytesToAddress(l.Topics[1].Bytes()), Amount: amount}
				return s, row.Scan(&s.Option.ID, &s.Option.ChainID, &s.Symbol, &s.Decimals)
			})
			if err != nil {
				return nil, fmt.Errorf("find the invoice: %w", err)
			}
			strays = append(strays, found...)
		}
	}
	return strays, nil
}

// PlanRecovery checks that a stray transfer can come back and gives the refund authority's calls: the receiver's
// deploy where it isn't deployed yet, then recover to the sender (or to). home is a client of the invoice's chain,
// there of the chain the money went to. It sends nothing; it locks the transfer, so its recover is printed once.
func PlanRecovery(ctx context.Context, db *pgxpool.Pool, home, there *ethclient.Client, s Stray, to *common.Address) (Recovery, error) {
	// Printed before: once sent, the address no longer holds it, which must not read as "can't be returned".
	var printed bool
	if err := db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM stray_recoveries WHERE chain_id = $1 AND tx_hash = $2 AND log_index = $3
		AND released_at IS NULL)`,
		s.ChainID, s.TxHash, s.LogIndex).Scan(&printed); err != nil {
		return Recovery{}, fmt.Errorf("read the lock: %w", err)
	}
	if printed {
		return Recovery{}, ErrRecoveryQueued
	}
	// A reorg could undo the transfer after its recover is printed, which would then pay out other money (D-45).
	head, err := there.HeaderByNumber(ctx, finalized)
	if err != nil {
		return Recovery{}, fmt.Errorf("read the finalized block: %w", err)
	}
	if head.Number.Uint64() < s.BlockNumber {
		return Recovery{}, ErrNotFinal
	}
	// And on the chain that finalized it: one RPC in a pool can answer from another fork. The block's own hash field,
	// not Header.Hash(), which is wrong on Tempo.
	var block struct {
		Hash common.Hash `json:"hash"`
	}
	if err := there.Client().CallContext(ctx, &block, "eth_getBlockByNumber", hexutil.EncodeUint64(s.BlockNumber), false); err != nil {
		return Recovery{}, fmt.Errorf("read the transfer's block: %w", err)
	}
	if block.Hash != s.BlockHash {
		return Recovery{}, ErrNotFinal
	}
	var recipient, token, receive, factory string
	var amount [3]string
	var expires, deadline int64
	var payable bool
	if err := db.QueryRow(ctx, `SELECT recipient_address, token_contract, amount::text, network_fee::text,
		platform_fee::text, expires_at, settle_deadline, receive_address, factory_address,
		payment_status IN ('open', 'detected', 'partially_paid') AND closes_at > extract(epoch FROM now())
		FROM invoices WHERE id = $1`, s.Option.ID).
		Scan(&recipient, &token, &amount[0], &amount[1], &amount[2], &expires, &deadline, &receive, &factory, &payable); err != nil {
		return Recovery{}, fmt.Errorf("read invoice %s: %w", s.Option.ID, err)
	}
	known, ok := address.KnownFactory(factory)
	if !ok {
		return Recovery{}, fmt.Errorf("invoice %s: its factory is not a Forwend factory", s.Option.ID)
	}
	terms, err := termsOf(known, s.Option.ID, recipient, token, amount, expires, deadline, s.Option.ChainID, receive)
	if err != nil {
		return Recovery{}, err
	}
	factoryAddress := common.Address(known)
	out, err := home.CallContract(ctx, ethereum.CallMsg{To: &factoryAddress, Data: authoritySelector}, nil)
	if err != nil {
		return Recovery{}, fmt.Errorf("factory.refundAuthority: %w", err)
	}
	if len(out) != 32 {
		return Recovery{}, fmt.Errorf("factory.refundAuthority: %d-byte answer", len(out))
	}
	r := Recovery{To: s.From, Authority: common.BytesToAddress(out)}
	if s.ChainID != s.Option.ChainID {
		if err := ours(ctx, home, there, known, r.Authority); err != nil {
			return Recovery{}, err
		}
	}
	if to != nil {
		r.To = *to
	}
	receiver := common.HexToAddress(receive)
	if r.To == (common.Address{}) || r.To == receiver || r.To == s.Token || address.Ours(r.To) {
		return Recovery{}, ErrDestination
	}
	var invoiceAddress bool
	if err := db.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM invoices WHERE receive_address = $1)",
		strings.ToLower(r.To.Hex())).Scan(&invoiceAddress); err != nil {
		return Recovery{}, fmt.Errorf("check the destination: %w", err)
	}
	if invoiceAddress {
		return Recovery{}, ErrDestination
	}
	if r.To != s.From {
		r.Warnings = append(r.Warnings, "This address didn't send the transfer: check the payer's proof that it is theirs.")
	}
	code, err := there.CodeAt(ctx, r.To, nil)
	if err != nil {
		return Recovery{}, fmt.Errorf("read the destination: %w", err)
	}
	if len(code) > 0 {
		r.Warnings = append(r.Warnings, "The destination is a contract (an exchange, an app or a smart wallet): check it can receive this token.")
	}
	held, err := there.CallContract(ctx, ethereum.CallMsg{To: &s.Token,
		Data: append(append([]byte{}, balanceOfSelector...), common.LeftPadBytes(receiver.Bytes(), 32)...)}, nil)
	if err != nil && !reverted(err) {
		return Recovery{}, fmt.Errorf("read the token's balance: %w", err)
	}
	if err != nil || len(held) != 32 {
		return Recovery{}, fmt.Errorf("%w: the token's balanceOf can't be read", ErrCantReturn)
	}
	if new(big.Int).SetBytes(held).Cmp(s.Amount) < 0 {
		return Recovery{}, fmt.Errorf("%w: the receive address holds less than this transfer", ErrCantReturn)
	}
	args := common.LeftPadBytes(r.To.Bytes(), 32)
	args = append(args, common.LeftPadBytes(s.Amount.Bytes(), 32)...)
	recoverData := append(append(append([]byte{}, recoverSelector...), common.LeftPadBytes(s.Token.Bytes(), 32)...), args...)
	status, err := factoryStatus(ctx, there, factoryAddress, terms)
	if err != nil {
		return Recovery{}, err
	}
	// A dry run as the chain would see it: a blocklisted address or a paused token fails here, before the Safe signs.
	if status.Deployed {
		if _, err := there.CallContract(ctx, ethereum.CallMsg{From: r.Authority, To: &receiver, Data: recoverData}, nil); err != nil {
			if !reverted(err) {
				return Recovery{}, fmt.Errorf("dry-run the recover: %w", err)
			}
			return Recovery{}, fmt.Errorf("%w: the receiver refuses this recover: %v", ErrCantReturn, err)
		}
	} else {
		transfer := append(append([]byte{}, transferSelector...), args...)
		if _, err := there.CallContract(ctx, ethereum.CallMsg{From: receiver, To: &s.Token, Data: transfer}, nil); err != nil {
			if !reverted(err) {
				return Recovery{}, fmt.Errorf("dry-run the transfer: %w", err)
			}
			return Recovery{}, fmt.Errorf("%w: the token refuses this transfer: %v", ErrCantReturn, err)
		}
		if s.ChainID == s.Option.ChainID && payable {
			r.Warnings = append(r.Warnings, "The invoice can still be paid. Deploying its receiver now starts its hold "+
				"limit, and on Arc it then refuses native USDC. Wait until the checkout closes if you can.")
		}
		deploy, err := address.Call(known, "deploy", terms)
		if err != nil {
			return Recovery{}, err
		}
		signature, _ := address.Signature(known, "deploy")
		args, _ := address.Args(known, s.Option.ID, terms)
		r.Calls = append(r.Calls, Call{To: factoryAddress, Data: deploy, Signature: signature, Args: []string{args}})
	}
	r.Calls = append(r.Calls, Call{To: receiver, Data: recoverData, Signature: recoverSignature,
		Args: []string{strings.ToLower(s.Token.Hex()), strings.ToLower(r.To.Hex()), s.Amount.String()}})
	// The lock: a second run sees the money of another transfer still there, and would return this one again.
	// A released transfer is locked again in its own row, which release counts from (00096).
	tag, err := db.Exec(ctx, `INSERT INTO stray_recoveries (chain_id, tx_hash, log_index, block_number, invoice_id,
		token_contract, destination, amount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (chain_id, tx_hash, log_index) DO UPDATE SET released_at = NULL, destination = EXCLUDED.destination,
		    queued_at = now() WHERE stray_recoveries.released_at IS NOT NULL`, s.ChainID,
		s.TxHash, s.LogIndex, s.BlockNumber, s.Option.ID, strings.ToLower(s.Token.Hex()), strings.ToLower(r.To.Hex()),
		s.Amount.String())
	if err != nil {
		return Recovery{}, fmt.Errorf("lock the transfer: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return Recovery{}, ErrRecoveryQueued
	}
	return r, nil
}

// ReleaseRecovery unlocks, one at a time, the recovers printed for a transaction that the refund authority will not
// send. The ledger books none of this, so the chain is the only proof. Locks of one key (chain, invoice, token,
// amount) are alike: a lock is released only while the receiver logged fewer recovers of that token and amount, to
// anyone, since the first transfer of that key ever locked, than the key's locks still held. Released rows stay, so
// that start never moves. A recover of it to the lock's own destination since its transfer keeps it too: that one
// was likely sent, and a mistaken release could otherwise pay out a recover still waiting in the Safe. It returns how
// many it released, and ErrRecoverySent when it kept any.
func ReleaseRecovery(ctx context.Context, db *pgxpool.Pool, clients map[uint64]*ethclient.Client, txHash string) (int64, error) {
	txHash = strings.ToLower(strings.TrimSpace(txHash))
	var released int64
	kept := false
	err := pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		// One release at a time: two at once could each count the other's lock.
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext('stray_recoveries'))"); err != nil {
			return fmt.Errorf("lock releases: %w", err)
		}
		rows, err := tx.Query(ctx, `SELECT s.chain_id, s.log_index, s.block_number, i.id, i.receive_address,
			s.token_contract, s.destination, s.amount::text FROM stray_recoveries s JOIN invoices i ON i.id = s.invoice_id
			WHERE s.tx_hash = $1 AND s.released_at IS NULL ORDER BY s.chain_id, s.log_index`, txHash)
		if err != nil {
			return fmt.Errorf("read the lock: %w", err)
		}
		type lock struct {
			chainID, logIndex, block           uint64
			invoice, receive, token, to, units string
		}
		locks, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (lock, error) {
			var l lock
			return l, row.Scan(&l.chainID, &l.logIndex, &l.block, &l.invoice, &l.receive, &l.token, &l.to, &l.units)
		})
		if err != nil {
			return fmt.Errorf("read the lock: %w", err)
		}
		if len(locks) == 0 {
			return ErrNoRecoveryQueued
		}
		for _, l := range locks {
			client, ok := clients[l.chainID]
			if !ok {
				return fmt.Errorf("chain %d is not enabled", l.chainID)
			}
			var first uint64
			var held int
			if err := tx.QueryRow(ctx, `SELECT min(block_number), count(*) FILTER (WHERE released_at IS NULL)
				FROM stray_recoveries WHERE chain_id = $1 AND invoice_id = $2 AND token_contract = $3 AND amount = $4::numeric`,
				l.chainID, l.invoice, l.token, l.units).Scan(&first, &held); err != nil {
				return fmt.Errorf("count the locks: %w", err)
			}
			amount, _ := new(big.Int).SetString(l.units, 10)
			receiver, invoice, token := common.HexToAddress(l.receive), common.HexToHash(l.invoice), common.HexToAddress(l.token)
			sent, err := recovers(ctx, client, first, receiver, invoice, token, nil, amount)
			if err != nil {
				return fmt.Errorf("chain %d: read the receiver's recovers: %w", l.chainID, err)
			}
			to := common.HexToAddress(l.to)
			own, err := recovers(ctx, client, l.block, receiver, invoice, token, &to, amount)
			if err != nil {
				return fmt.Errorf("chain %d: read the receiver's recovers: %w", l.chainID, err)
			}
			if sent >= held || own > 0 {
				kept = true
				continue
			}
			if _, err := tx.Exec(ctx, `UPDATE stray_recoveries SET released_at = now()
				WHERE chain_id = $1 AND tx_hash = $2 AND log_index = $3`, l.chainID, txHash, l.logIndex); err != nil {
				return fmt.Errorf("release the recover: %w", err)
			}
			released++
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	if kept {
		return released, ErrRecoverySent
	}
	return released, nil
}

// logRange is the most blocks one getLogs asks for, as the watcher's: public RPCs refuse more.
const logRange = 2000

// recovers counts the receiver's Recovered logs of a token and amount, to one address or (nil) anyone, from a block
// to the latest.
func recovers(ctx context.Context, client *ethclient.Client, from uint64, receiver common.Address, invoice common.Hash,
	token common.Address, to *common.Address, amount *big.Int) (int, error) {
	latest, err := client.BlockNumber(ctx)
	if err != nil {
		return 0, err
	}
	topics := [][]common.Hash{{recoveredTopic}, {invoice}, {common.BytesToHash(token.Bytes())}}
	if to != nil {
		topics = append(topics, []common.Hash{common.BytesToHash(to.Bytes())})
	}
	n := 0
	for start := from; start <= latest; start += logRange {
		logs, err := client.FilterLogs(ctx, ethereum.FilterQuery{FromBlock: new(big.Int).SetUint64(start),
			ToBlock: new(big.Int).SetUint64(min(start+logRange-1, latest)), Addresses: []common.Address{receiver},
			Topics: topics})
		if err != nil {
			return 0, err
		}
		for _, g := range logs {
			if len(g.Data) == 32 && new(big.Int).SetBytes(g.Data).Cmp(amount) == 0 {
				n++
			}
		}
	}
	return n, nil
}

// reverted tells a call the chain refused from an RPC that failed (rate limited, no state), which must not read as
// "can't be returned". The RPC pool rewrites every revert to this message (chain.safeMessage); code 3 is the standard.
func reverted(err error) bool {
	var e rpc.Error
	if errors.As(err, &e) && e.ErrorCode() == 3 {
		return true
	}
	return strings.Contains(err.Error(), "execution reverted")
}

// ours is nil when the chain the money went to has our factory with our receiver code, and our refund authority:
// the same key, or a Safe with the same code, singleton, owners, threshold and modules. Anyone can put other code at
// these addresses.
func ours(ctx context.Context, home, there *ethclient.Client, factory [20]byte, authority common.Address) error {
	// Both chains' answers for one read; a failed read is an error, never "not ours".
	same := func(read func(*ethclient.Client) ([]byte, error)) (bool, int, error) {
		a, err := read(home)
		if err != nil {
			return false, 0, err
		}
		b, err := read(there)
		if err != nil {
			return false, 0, err
		}
		return bytes.Equal(a, b), len(a), nil
	}
	code := func(at common.Address) func(*ethclient.Client) ([]byte, error) {
		return func(c *ethclient.Client) ([]byte, error) { return c.CodeAt(ctx, at, nil) }
	}
	if ok, n, err := same(code(common.Address(factory))); err != nil {
		return fmt.Errorf("read the factory: %w", err)
	} else if !ok || n == 0 {
		return fmt.Errorf("%w: that chain has no Forwend factory at %s", ErrCantReturn, common.Address(factory).Hex())
	}
	if ok, n, err := same(code(common.Address(address.Known[factory].Implementation))); err != nil {
		return fmt.Errorf("read the receiver code: %w", err)
	} else if !ok || n == 0 {
		return fmt.Errorf("%w: that chain has no Forwend receiver code", ErrCantReturn)
	}
	ok, n, err := same(code(authority))
	if err != nil {
		return fmt.Errorf("read the refund authority: %w", err)
	}
	if !ok {
		return fmt.Errorf("%w: the refund authority %s is not the same on that chain", ErrCantReturn, authority.Hex())
	}
	if n == 0 {
		return nil // a key: the same on every chain
	}
	if ok, _, err := same(func(c *ethclient.Client) ([]byte, error) {
		return c.StorageAt(ctx, authority, common.Hash{}, nil)
	}); err != nil {
		return fmt.Errorf("read the Safe's singleton: %w", err)
	} else if !ok {
		return fmt.Errorf("%w: the refund authority's Safe on that chain is another kind", ErrCantReturn)
	}
	for _, data := range [][]byte{ownersSelector, thresholdSelector, modulesSelector} {
		ok, _, err := same(func(c *ethclient.Client) ([]byte, error) {
			return c.CallContract(ctx, ethereum.CallMsg{To: &authority, Data: data}, nil)
		})
		if err != nil && !reverted(err) {
			return fmt.Errorf("read the Safe: %w", err)
		}
		if err != nil || !ok {
			return fmt.Errorf("%w: the refund authority's Safe on that chain has other owners or modules", ErrCantReturn)
		}
	}
	return nil
}
