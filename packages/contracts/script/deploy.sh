#!/usr/bin/env bash
# Usage: script/deploy.sh <chain> [<token> <amount in base units>]; with a token it also runs a real invoice flow.
# Reads keys from packages/contracts/.env and never prints them.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a && . ./.env && set +a

chain=$1
# The RPC URL holds the Infura key: forge and cast read it from the environment, never from their arguments.
ETH_RPC_URL=$(node script/rpc.mjs "$chain")
export ETH_RPC_URL
REFUND_AUTHORITY=$(cast wallet address --private-key "$REFUND_AUTHORITY_PRIVATE_KEY")
# The first executor is part of the factory address, so it stays fixed when setExecutor moves signing to another key.
EXECUTOR=${FIRST_EXECUTOR:?set FIRST_EXECUTOR in .env}
export REFUND_AUTHORITY EXECUTOR
deployer=$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")

# Gas comes from the chain's own estimate: Tempo prices contract and storage creation differently from Ethereum.
out=$(forge script script/Smoke.s.sol --rpc-url deploy --broadcast --slow --skip-simulation)
factory=$(grep -m1 -oE 'factory 0x[0-9a-fA-F]{40}' <<<"$out" | cut -d' ' -f2)
probe=$(grep -m1 -oE 'probe receiver 0x[0-9a-fA-F]{40}' <<<"$out" | cut -d' ' -f3)
implementation=$(cast call "$factory" "implementation()(address)")
echo "chain=$chain factory=$factory implementation=$implementation probe=$probe refundAuthority=$REFUND_AUTHORITY executor=$EXECUTOR"
[ $# -lt 3 ] && exit 0

token=$2
amount=$3
extra=$((amount / 10))
T='(bytes32,address,address,uint256,uint64,uint64,uint256)'
recipient=0x$(cast keccak "forwend.testnet.recipient" | tail -c 41)
chain_id=$(cast chain-id)
now=$(cast block latest --field timestamp)
id=$(cast keccak "forwend.testnet.flow.$chain_id.$now")
terms="($id,$recipient,$token,$amount,$((now + 3600)),$((now + 3600 + 86400)),$chain_id)"
at=$(cast call "$factory" "predict($T)(address)" "$terms")
balance() { cast call "$token" "balanceOf(address)(uint256)" "$1" | cut -d' ' -f1; }
tx() {
  cast send --json "$@" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);if(r.status!=="0x1"){console.error(r);process.exit(1)}console.log(r.transactionHash)})'
}

before=$(balance "$recipient")
pay=$(tx "$token" "transfer(address,uint256)" "$at" $((amount + extra)) --private-key "$DEPLOYER_PRIVATE_KEY")
deploy=$(tx "$factory" "deploy($T)" "$terms" --private-key "$DEPLOYER_PRIVATE_KEY")
settle=$(tx "$at" "settle()" --private-key "$DEPLOYER_PRIVATE_KEY")
refund=$(tx "$at" "refund(address,uint256)" "$deployer" "$extra" --private-key "$REFUND_AUTHORITY_PRIVATE_KEY")

[ $(($(balance "$recipient") - before)) -eq "$amount" ] || { echo "recipient not paid exactly $amount" >&2; exit 1; }
[ "$(balance "$at")" -eq 0 ] || { echo "receiver not empty" >&2; exit 1; }
# statusOf: (receiver, deployed, onIntendedChain, balance, settled, refundable, ...) must read settled and empty.
status=$(cast call "$factory" "statusOf(bytes32)((address,bool,bool,uint256,bool,uint256,bool,address,uint64))" "$id")
grep -qi "^($at, true, true, 0, true, 0, " <<<"$status" || { echo "statusOf mismatch: $status" >&2; exit 1; }
echo "flow invoiceId=$id receiver=$at pay=$pay deploy=$deploy settle=$settle refund=$refund"
