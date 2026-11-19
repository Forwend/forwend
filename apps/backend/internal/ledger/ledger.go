// Package ledger books confirmed deposits and moves each invoice's payment status from the money it holds (R-21).
package ledger

import "math/big"

// Payment statuses. paid, expired, expired_partially_paid and canceled are final but for one Reopen (R-130); the
// database rejects any other transition. The owner cancels (invoice.Cancel); the ledger never does.
const (
	Open                 = "open"
	Detected             = "detected"
	PartiallyPaid        = "partially_paid"
	Paid                 = "paid"
	Expired              = "expired"
	ExpiredPartiallyPaid = "expired_partially_paid"
	Canceled             = "canceled"
)

// Why money is held for the payer (D-26), in the order a run writes them to the history.
const (
	HeldOverpaid    = "overpaid" // more than the amount, or sent after it was paid
	HeldLate        = "late"     // sent after the checkout closed
	HeldExpired     = "expired"  // what was paid of an invoice that expired unpaid; the owner may reopen it (R-130)
	HeldCanceled    = "canceled"
	HeldOtherOption = "other_option" // sent to an option the payer did not choose (D-76)
)

var heldReasons = []string{HeldOverpaid, HeldLate, HeldExpired, HeldCanceled, HeldOtherOption}

// heldReason is why the held part of a deposit is the payer's.
func heldReason(current string, late, superseded bool) string {
	switch {
	case current == Canceled:
		return HeldCanceled
	case superseded:
		return HeldOtherOption
	case late || current == Expired || current == ExpiredPartiallyPaid:
		return HeldLate
	}
	return HeldOverpaid
}

// Final is a status that takes no more money for the creator: every later deposit is held for the payer (D-26).
func Final(status string) bool {
	return status == Paid || status == Expired || status == ExpiredPartiallyPaid || status == Canceled
}

// MayHoldMoneySQL is true for an invoice row that can still owe its creator or hold money. A settled one holds only
// money held for the payer, which sets its refund status; an expired one took none for its creator (Final). The
// invoices_money_* partial indexes (migration 00120) have this predicate, so a reader that adds it reads only these rows.
const MayHoldMoneySQL = `refund_status IN ('held', 'refund_pending') OR settlement_status <> 'settled' AND payment_status <> 'expired'`

// split divides a deposit between what is still owed to the creator and what is held for the payer (D-24, D-26).
// Nothing goes to the creator once the invoice is final or the deposit is late.
func split(amount, owedSoFar, deposit *big.Int, late, final bool) (toCreator, toHeld *big.Int) {
	toCreator = new(big.Int)
	if !late && !final {
		toCreator.Sub(amount, owedSoFar)
		if toCreator.Sign() < 0 {
			toCreator.SetInt64(0)
		}
		if toCreator.Cmp(deposit) > 0 {
			toCreator.Set(deposit)
		}
	}
	return toCreator, new(big.Int).Sub(deposit, toCreator)
}

// funded: the finalized balance confirms the receive address holds every booked deposit; mayExpire: expiry has passed and
// the chain holds exactly what is booked.
func status(current string, amount, owed *big.Int, anyTransfer, mayExpire, funded bool) string {
	switch {
	case Final(current):
		return current
	case owed.Cmp(amount) >= 0 && funded:
		return Paid
	case owed.Cmp(amount) >= 0 && current == PartiallyPaid:
		return PartiallyPaid // the database allows no way back to detected
	case owed.Cmp(amount) >= 0:
		// Paid in full and on time, waiting for the finalized balance check; it never expires.
		return Detected
	case mayExpire && owed.Sign() > 0:
		return ExpiredPartiallyPaid
	case mayExpire:
		return Expired
	case owed.Sign() > 0:
		return PartiallyPaid
	case anyTransfer:
		return Detected
	}
	return Open
}
