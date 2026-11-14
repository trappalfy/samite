# samite_escrow: program self-review

> **This is a self-review**, written by the developer (Claude Code) for the owner to read before M2 is accepted
> (CLAUDE.md §14). It is **not an audit**: nobody outside the project has reviewed this program, and nothing here should
> be presented as audited (§0, §12).

It lists every instruction, who signs it, every check it makes, and the test that proves each check fails when it
should. Source: `programs/samite_escrow/src/`. Tests: `programs/samite_escrow/tests/` (LiteSVM) and the unit tests in
`src/settle.rs`.

## How to run

```sh
anchor build                  # builds target/deploy/samite_escrow.so and target/idl/samite_escrow.json
cargo test -p samite_escrow   # 167 tests: 3 unit + 164 LiteSVM integration tests
```

Toolchain: Anchor 1.2.2, Solana (Agave) 4.4.0, host Rust 1.99.0 (`rust-toolchain.toml`), LiteSVM 0.18.2. CI runs the
same in the `program` job (with `anchor build --ignore-keys`, since the program keypair is never in git), plus
`cargo fmt --check`, `cargo clippy -D warnings`, and checks that the committed IDL and the generated client match the
build. Nothing in the tests or CI talks to a cluster.

Tests are named for what they prove; `*_fails` tests assert the **exact** error code, so a test can't pass because some
other check happened to fail first. Where the code alone is ambiguous they also check the cause: the account an Anchor
error names (`assert_anchor_err_on`), or the log line of the System or SPL Token program that refused a CPI
(`assert_cpi_err`).

The fixes for the review findings of Nov 12 are listed in [Review findings (Nov 12)](#review-findings-nov-12).

## Invariants

| #   | Invariant                                                                                                                                                                                                                    | How it holds                                                                                                                                                                                                                                                                                                                                                                                                  | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Funds never mix.** Each job's reward sits in its own vault: the USDC ATA of the job PDA.                                                                                                                                   | `post_job` creates the vault (`init_if_needed`, `associated_token::authority = job`), or takes one someone created first only if Anchor finds it is the job PDA's USDC ATA (address, mint, owner, token program) and the handler finds no delegate and no close authority. Every later instruction re-derives it with `associated_token::mint = usdc_mint, authority = job`.                                  | `a_poster_can_run_several_jobs_at_once`, `payout_from_a_vault_that_is_not_the_jobs_fails`, `post_with_a_vault_that_is_not_the_jobs_ata_fails`, `post_with_a_job_owned_usdc_account_that_is_not_its_ata_fails`, `post_with_a_vault_address_that_is_not_the_jobs_ata_fails`, `post_with_an_existing_vault_owned_by_someone_else_fails`, `post_with_an_existing_vault_that_has_a_delegate_fails`, `post_with_an_existing_vault_that_has_a_close_authority_fails`                                                                                                                                                                        |
| 2   | **Money leaves a vault in exactly two ways**: `settle::pay_machine` (to the job's machine + fee to the treasury) or `settle::refund_poster` (everything to the poster).                                                      | They are the only code that signs with the job PDA's seeds (`settle.rs`); `pay_machine` is called only by `accept_delivery` and `release_after_review`, `refund_poster` only by `cancel_job`, `refund_after_deadline` and the last `reject_delivery`.                                                                                                                                                         | every happy path below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3   | **No admin path to escrowed funds.**                                                                                                                                                                                         | The admin instructions (`update_config`, `propose_admin`, `accept_admin`) take only `Config` (and optionally a new treasury owner and its USDC ATA, which they don't move money from). No instruction takes a destination chosen by the admin except the fee account, which only ever receives `floor(reward × fee_bps / 10 000)` of a payout (or nothing, see 6).                                            | `while_paused_cancel_unclaim_expire_deliver_accept_reject_release_and_refund_all_work`, `a_new_treasury_receives_fees_from_then_on`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 4   | **Pause can't trap money.** `paused` blocks `post_job` and `claim_job` only.                                                                                                                                                 | `constraint = !config.paused` appears on those two instructions and nowhere else.                                                                                                                                                                                                                                                                                                                             | `pause_blocks_post_job`, `pause_blocks_claim_job`, `while_paused_cancel_unclaim_expire_deliver_accept_reject_release_and_refund_all_work`, `unpausing_restores_post_and_claim`                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 5   | **The fee is capped and fixed per job.**                                                                                                                                                                                     | `fee_bps ≤ MAX_FEE_BPS (500)` at `initialize_config` and `update_config`; `post_job` snapshots `Config.fee_bps` into `Job.fee_bps`; the payout uses the snapshot.                                                                                                                                                                                                                                             | `update_config_with_fee_above_max_fails`, `initialize_config_with_fee_above_max_fails`, `initialize_config_with_fee_at_max_succeeds`, `a_fee_change_applies_to_new_jobs_only`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 6   | **The payout splits exactly**: `fee = floor(reward × fee_bps / 10 000)` in `u128`, `to_machine = reward − fee`. The one exception: if the treasury is this job's own vault, the fee is 0 (else the vault could never close). | `settle::split_reward`, checked arithmetic; the waiver in `settle::pay_machine`.                                                                                                                                                                                                                                                                                                                              | `split_reward_holds_for_every_reward_up_to_ten_usdc` (every reward 1…10 000 000 × 5 fee levels), `split_reward_does_not_overflow_at_u64_max`, `split_reward_matches_the_prototype_numbers` (120 → 117 + 3, 80 → 78 + 2), and on-chain `payout_splits_every_reward_exactly_on_chain` (216 full payouts, 7 fee levels, accept and auto-release), `payout_when_the_treasury_is_this_jobs_own_vault_waives_the_fee`                                                                                                                                                                                                                      |
| 7   | **Rent always goes back to the poster**, whoever sends the closing transaction.                                                                                                                                              | `close = poster` with `has_one = poster` on the job; the vault's `close_account` destination is the same `poster` account; `reject_delivery`'s manual close uses the signing poster.                                                                                                                                                                                                                          | `post_then_cancel_returns_the_reward_and_all_rent`, `post_no_claim_deadline_then_anyone_refunds`, `post_claim_deliver_accept_pays_exactly`, `three_rejections_refund_the_poster_and_close_the_job`, `refund_with_rent_sent_to_someone_else_fails`, `release_with_rent_sent_to_someone_other_than_the_poster_fails`                                                                                                                                                                                                                                                                                                                   |
| 8   | **Classic SPL Token only, with `transfer_checked`.**                                                                                                                                                                         | Every token instruction takes `token_program: Program<Token>` (rejects Token-2022 with `InvalidProgramId`); token accounts are `Account<TokenAccount>` (owner must be classic SPL Token); every transfer is `transfer_checked` with the mint's decimals.                                                                                                                                                      | `*_with_wrong_token_program_fails` (init, post, claim, cancel, refund, accept, release)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 9   | **One mint**: everything is USDC (`Config.usdc_mint`, set once from the `USDC_MINT` constant, never changeable).                                                                                                             | `address = config.usdc_mint` on every `usdc_mint` account; ATAs are derived from it.                                                                                                                                                                                                                                                                                                                          | `initialize_config_with_a_different_mint_fails`, `post_with_a_different_mint_than_config_fails`, `claim_with_a_different_mint_than_config_fails`, `payout_with_a_different_mint_than_config_fails`, `refund_with_a_different_mint_than_config_fails`                                                                                                                                                                                                                                                                                                                                                                                 |
| 10  | **Checked math only, no `remaining_accounts`.**                                                                                                                                                                              | All arithmetic on amounts and times uses `checked_*` (error `MathOverflow`); `ctx.remaining_accounts` is never read; the release profile also has `overflow-checks = true`.                                                                                                                                                                                                                                   | code review; `split_reward_does_not_overflow_at_u64_max`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 11  | **Payouts and posts can't be blocked by someone else's action.**                                                                                                                                                             | Extra USDC sent into a vault leaves with the main transfer (else the vault couldn't close). The treasury may equal the machine's ATA (`dup`). The treasury is always the USDC ATA of `Config.treasury_owner`, so if it is closed anyone re-creates it (`CreateIdempotent`) in the payout's transaction. A treasury that is the job's own vault waives the fee. A vault created before `post_job` is accepted. | `a_donation_to_the_vault_does_not_block_cancel`, `a_donation_to_the_vault_does_not_block_refund`, `a_donation_to_the_vault_goes_to_the_machine_and_does_not_block_the_payout`, `payout_when_the_treasury_is_the_machines_own_ata_succeeds`, `a_closed_treasury_blocks_the_payout_until_anyone_recreates_it`, `payout_when_the_treasury_is_this_jobs_own_vault_waives_the_fee`, `post_succeeds_when_someone_created_the_vault_first`                                                                                                                                                                                                  |
| 12  | **Every state change emits an event via `emit_cpi!`.**                                                                                                                                                                       | One `emit_cpi!` per handler (two on the last rejection).                                                                                                                                                                                                                                                                                                                                                      | event asserts in `config_instructions_emit_events`, `post_job_locks_the_reward_and_records_the_job`, `post_then_cancel_returns_the_reward_and_all_rent`, `post_no_claim_deadline_then_anyone_refunds`, `claim_sets_the_worker_and_creates_machine_stats_paid_by_the_machine`, `claim_unclaim_then_claim_by_another`, `claim_with_claim_window_then_anyone_expires_the_claim`, `post_claim_deliver_accept_pays_exactly`, `post_claim_deliver_no_answer_then_anyone_releases_after_review`, `reject_then_redeliver_then_accept`, `three_rejections_refund_the_poster_and_close_the_job`, `payout_splits_every_reward_exactly_on_chain` |
| 13  | **A machine's record can't be bought.** `MachineStats.earned` grows by exactly `reward − fee` per paid job; USDC sent into a vault reaches the machine's ATA but is never counted.                                           | `settle::pay_machine` credits `earned` with the split, not with the amount sent.                                                                                                                                                                                                                                                                                                                              | `donations_cannot_inflate_earned`, `a_donation_to_the_vault_goes_to_the_machine_and_does_not_block_the_payout`, `a_vault_created_first_pays_the_machine_the_reward_minus_fee_as_earned`                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 14  | **A claim can't be renewed by the key that held it.**                                                                                                                                                                        | `unclaim_job` and `expire_claim` record the machine in `Job.previous_worker`; `claim_job` refuses that machine (`CannotReclaim`), also inside the same transaction.                                                                                                                                                                                                                                           | `unclaim_then_reclaim_by_the_same_machine_fails`, `unclaim_and_reclaim_in_one_transaction_fails`, `squatter_expires_and_reclaims_in_one_tx_fails`, `expire_then_reclaim_by_the_same_machine_fails`, `only_the_last_machine_to_leave_is_barred`                                                                                                                                                                                                                                                                                                                                                                                       |

Mutation check: three guards were removed one at a time from the built program (the `dup` on the treasury, the vault
extra in the payout, the `MIN_RESUBMIT` hold in `expire_claim`); in each case the matching test failed. For the Nov 12
fixes, eleven more were removed one at a time (the reclaim check in `claim_job`; `previous_worker` in `unclaim_job`; in
`expire_claim`; `earned` counting `reward − fee`; the fee waiver; `check_treasury` in `initialize_config`; in
`update_config`; the program-owned treasury owner check; the zero-address check in `propose_admin`; `init_if_needed` on
the vault; the vault delegate / close authority check) and each made 1–8 of the new tests fail. That only proves those
tests can fail, not that the suite is complete.

## Accounts

| Account         | Address                                           | Created by, paid by                              | Closed                                |
| --------------- | ------------------------------------------------- | ------------------------------------------------ | ------------------------------------- |
| `Config`        | PDA `["config"]`, 181 bytes                       | `initialize_config`, upgrade authority           | never                                 |
| `Job`           | PDA `["job", poster, job_id (u64 LE)]`, 568 bytes | `post_job`, poster                               | when the job ends; rent to the poster |
| vault           | USDC ATA of the `Job` PDA                         | `post_job`, poster (or whoever created it first) | with the job; rent to the poster      |
| `MachineStats`  | PDA `["machine", machine]`                        | first `claim_job`, the machine                   | never                                 |
| event authority | PDA `["__event_authority"]` (Anchor)              | —                                                | —                                     |

Fields added after §4.2 (at the end of each account): `Config.pending_admin: Option<Pubkey>` (two-step admin),
`Config.treasury_owner: Pubkey` (the wallet or multisig whose USDC ATA is `Config.treasury`), and
`Job.previous_worker: Option<Pubkey>` (the machine whose claim last ended by `unclaim_job` or `expire_claim`).

Every instruction that reads a `Job` re-checks its seeds and bump (`seeds = [JOB_SEED, job.poster, job.job_id], bump =
job.bump`) and Anchor checks its owner and discriminator. Errors: Anchor's built-in codes for account constraints
(e.g. `ConstraintTokenOwner` 2015, `ConstraintSeeds` 2006, `AccountNotInitialized` 3012, `InvalidProgramId` 3008) and
`EscrowError` (6000+) for everything else.

## Instructions

Each instruction lists: **signer**, **accounts and their constraints**, **checks in the handler**, **effect**,
**event**, then a table of each check and its test.

### `initialize_config(fee_bps, min_reward)`

- **Signer:** `authority`, which must be the program's upgrade authority. Becomes `admin`.
- **Accounts:** `config` (`init`, PDA `["config"]`); `usdc_mint` (`address = USDC_MINT`, classic SPL Token mint);
  `treasury_owner` (any account **not owned by this program**, so never a job); `treasury` (a classic SPL Token
  account); `samite_program` (this program; its `programdata_address()` must equal `program_data`); `program_data`
  (`upgrade_authority_address == Some(authority)`); `token_program` (`Program<Token>`).
- **Handler:** `fee_bps ≤ 500`; `min_reward > 0`; mint decimals = 6; `check_treasury`: `treasury` is at the address
  of `treasury_owner`'s USDC ATA (classic SPL Token), its token owner is `treasury_owner` and its mint is USDC.
- **Effect:** writes `Config { admin = authority, treasury, treasury_owner, usdc_mint, fee_bps, min_reward,
paused = false }`.
- **Event:** `ConfigInitialized`.

| Check                                                                                                      | Test                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sets every field                                                                                           | `initialize_config_sets_every_field`                                                                                                                                                   |
| signer is the upgrade authority                                                                            | `initialize_config_by_non_upgrade_authority_fails`                                                                                                                                     |
| an immutable program (no authority) can't be initialised                                                   | `initialize_config_without_upgrade_authority_fails`                                                                                                                                    |
| `program_data` belongs to this program (an attacker's own ProgramData is refused)                          | `initialize_config_with_another_programs_program_data_fails`                                                                                                                           |
| `program_data` is a ProgramData account                                                                    | `initialize_config_with_a_non_program_data_account_fails`                                                                                                                              |
| only once                                                                                                  | `initialize_config_twice_fails`                                                                                                                                                        |
| fee ≤ 500 (and exactly 500 is allowed)                                                                     | `initialize_config_with_fee_above_max_fails`, `initialize_config_with_fee_at_max_succeeds`                                                                                             |
| min reward > 0                                                                                             | `initialize_config_with_zero_min_reward_fails`                                                                                                                                         |
| mint is USDC                                                                                               | `initialize_config_with_a_different_mint_fails`                                                                                                                                        |
| treasury is the owner's USDC ATA: not another mint's ATA, not another USDC account, not someone else's ATA | `initialize_config_with_a_non_usdc_treasury_fails`, `initialize_config_with_a_treasury_that_is_not_the_owners_ata_fails`, `initialize_config_with_someone_elses_ata_as_treasury_fails` |
| treasury owner is not a program account                                                                    | `initialize_config_with_a_program_owned_treasury_owner_fails`                                                                                                                          |
| classic token program                                                                                      | `initialize_config_with_wrong_token_program_fails`                                                                                                                                     |

### `update_config(fee_bps?, min_reward?, paused?)` + optional `new_treasury_owner` and `new_treasury`

- **Signer:** `admin` (`has_one = admin` on `config`).
- **Accounts:** `config` (mut, PDA); `new_treasury_owner` (optional; not owned by this program); `new_treasury`
  (optional; a classic SPL Token account).
- **Handler:** each `Some` value replaces the setting: `fee_bps ≤ 500`; `min_reward > 0`. Fee changes affect new jobs
  only (each job keeps its snapshot). The treasury changes only when both accounts are passed
  (`TreasuryOwnerAndAtaRequired` otherwise), after the same `check_treasury` as at init; both fields change together.
- **Event:** `ConfigUpdated` (full new settings).

| Check                                                           | Test                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| changes each setting; `None` keeps it                           | `update_config_changes_fee_min_reward_paused_and_treasury`, `update_config_with_nothing_set_changes_nothing`                                                                                                                                                                                                                                                                   |
| signer is the admin                                             | `update_config_by_non_admin_fails`                                                                                                                                                                                                                                                                                                                                             |
| fee ≤ 500                                                       | `update_config_with_fee_above_max_fails`                                                                                                                                                                                                                                                                                                                                       |
| min reward > 0                                                  | `update_config_with_zero_min_reward_fails`                                                                                                                                                                                                                                                                                                                                     |
| new treasury is the new owner's USDC ATA, and exists            | `update_config_with_a_non_usdc_treasury_fails`, `update_config_with_a_treasury_that_is_not_a_token_account_fails`, `update_config_with_a_treasury_whose_ata_does_not_exist_fails`, `update_config_with_a_treasury_that_is_not_the_owners_ata_fails`, `update_config_with_someone_elses_ata_as_treasury_fails`, `update_config_with_an_ata_whose_token_owner_was_changed_fails` |
| new treasury owner is not a program account (a job, the config) | `update_config_with_a_job_as_treasury_owner_fails`, `update_config_with_the_config_as_treasury_owner_fails`                                                                                                                                                                                                                                                                    |
| owner and ATA come together                                     | `update_config_with_only_one_of_treasury_owner_and_treasury_fails`                                                                                                                                                                                                                                                                                                             |
| fee change applies to new jobs only                             | `a_fee_change_applies_to_new_jobs_only`                                                                                                                                                                                                                                                                                                                                        |
| old treasury refused after a change                             | `a_new_treasury_receives_fees_from_then_on`                                                                                                                                                                                                                                                                                                                                    |

### `propose_admin(new_admin)` and `accept_admin` (§4.3's `set_admin`)

- **Signers:** `propose_admin`: the admin. `accept_admin`: the proposed key (`config.pending_admin == Some(signer)`).
- **Handler:** `propose_admin` refuses the all-zero address (`InvalidNewAdmin`): nobody can sign for it.
- **Effect:** propose sets `pending_admin`; accept moves `admin` and clears `pending_admin`. A new proposal replaces an
  old one.
- **Events:** `AdminProposed`, `AdminAccepted`.

| Check                                                    | Test                                         |
| -------------------------------------------------------- | -------------------------------------------- |
| two steps move the admin; the old admin loses its rights | `propose_then_accept_admin_moves_admin`      |
| only the admin proposes                                  | `propose_admin_by_non_admin_fails`           |
| only the proposed key accepts                            | `accept_admin_by_someone_not_proposed_fails` |
| a later proposal wins                                    | `a_second_proposal_replaces_the_first`       |
| never the all-zero address                               | `propose_admin_of_the_default_address_fails` |

### `post_job(job_id, reward, deadline, review_window, claim_window, policy, allowlist, spec_hash)`

- **Signer:** `poster` (pays the job's rent, and the vault's unless someone created the vault first).
- **Accounts:** `config` (`!paused`); `usdc_mint` (`== config.usdc_mint`); `poster_token` (the poster's USDC ATA);
  `job` (`init`, PDA `["job", poster, job_id]`, so a repeated `job_id` fails); `vault` (`init_if_needed`, ATA of
  `job`: if it exists already, Anchor checks its address, mint, owner and token program); `token_program`
  (`Program<Token>`), `associated_token_program`, `system_program`.
- **Handler (§4.4):** `reward ≥ min_reward`; `now + 1 h ≤ deadline ≤ now + 90 d`; `1 h ≤ review_window ≤ 7 d`;
  `claim_window == 0` or `1 h ≤ claim_window ≤ deadline − now`; `Allowlist` ⇒ 1–10 addresses, otherwise empty;
  `spec_hash ≠ 0`; the vault has no delegate and no close authority.
- **Effect:** `transfer_checked(poster_token → vault, reward)`, exactly `reward` whatever the vault held before (an
  earlier balance is a donation, not reward); job `Open`, `fee_bps` = config snapshot, `previous_worker = None`.
- **Event:** `JobPosted`.

| Check                                                                                    | Test                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| locks the reward, records every field, exact balances and rents                          | `post_job_locks_the_reward_and_records_the_job`                                                                                                                                                                                                                                                                             |
| not paused                                                                               | `pause_blocks_post_job`                                                                                                                                                                                                                                                                                                     |
| reward ≥ min (and = min is allowed)                                                      | `post_reward_below_min_fails`, `post_reward_at_min_succeeds`                                                                                                                                                                                                                                                                |
| deadline window                                                                          | `post_deadline_sooner_than_one_hour_fails`, `post_deadline_in_the_past_fails`, `post_deadline_later_than_90_days_fails`, `post_deadline_at_both_bounds_succeeds`                                                                                                                                                            |
| review window                                                                            | `post_review_window_shorter_than_one_hour_fails`, `post_review_window_longer_than_seven_days_fails`, `post_review_window_at_both_bounds_succeeds`                                                                                                                                                                           |
| claim window                                                                             | `post_claim_window_shorter_than_one_hour_fails`, `post_negative_claim_window_fails`, `post_claim_window_past_the_deadline_fails`, `post_without_a_claim_window_fails` (0 refused since Nov 13), `post_claim_window_one_hour_and_up_to_the_deadline_succeed`                                                                 |
| allowlist shape                                                                          | `post_allowlist_policy_with_an_empty_list_fails`, `post_allowlist_of_eleven_fails`, `post_allowlist_of_ten_succeeds`, `post_list_with_a_policy_other_than_allowlist_fails`                                                                                                                                                  |
| spec hash present                                                                        | `post_zero_spec_hash_fails`                                                                                                                                                                                                                                                                                                 |
| `job_id` collision (System Program: already in use)                                      | `post_same_job_id_twice_fails`                                                                                                                                                                                                                                                                                              |
| enough USDC (SPL Token: insufficient funds)                                              | `post_more_than_the_poster_holds_fails`                                                                                                                                                                                                                                                                                     |
| USDC mint, classic token program                                                         | `post_with_a_different_mint_than_config_fails`, `post_with_wrong_token_program_fails`                                                                                                                                                                                                                                       |
| funds come from the poster's own ATA                                                     | `post_from_someone_elses_token_account_fails`                                                                                                                                                                                                                                                                               |
| vault is the job's ATA                                                                   | `post_with_a_vault_that_is_not_the_jobs_ata_fails` (`ConstraintTokenOwner`), `post_with_a_job_owned_usdc_account_that_is_not_its_ata_fails` (`AccountNotAssociatedTokenAccount`), `post_with_a_vault_address_that_is_not_the_jobs_ata_fails` (the ATA program only creates at the real address: `MissingAccount` naming it) |
| a vault created first is accepted; exactly `reward` moves; the extra leaves with the job | `post_succeeds_when_someone_created_the_vault_first`, `a_vault_created_first_pays_the_machine_the_reward_minus_fee_as_earned`                                                                                                                                                                                               |
| an existing vault must be clean                                                          | `post_with_an_existing_vault_that_has_a_delegate_fails`, `post_with_an_existing_vault_that_has_a_close_authority_fails`, `post_with_an_existing_vault_owned_by_someone_else_fails`                                                                                                                                          |

### `cancel_job`

- **Signer:** `poster` (`has_one = poster`).
- **Accounts:** `job` (mut, seeds, `close = poster`); `usdc_mint`; `vault` (ATA of `job`); `poster_token` (poster's
  USDC ATA); `token_program`.
- **Handler:** status `Open`.
- **Effect:** `refund_poster`: whole vault → `poster_token`, vault closed → poster; job closed → poster. No fee.
- **Event:** `JobCancelled`. Works while paused.

| Check                                            | Test                                               |
| ------------------------------------------------ | -------------------------------------------------- |
| full reward and all rent back, no fee            | `post_then_cancel_returns_the_reward_and_all_rent` |
| only the poster                                  | `cancel_by_non_poster_fails`                       |
| only while `Open`                                | `cancel_a_claimed_job_fails`                       |
| once (the closed job is `AccountNotInitialized`) | `cancel_twice_fails`                               |
| classic token program                            | `cancel_with_wrong_token_program_fails`            |
| a donation can't block it                        | `a_donation_to_the_vault_does_not_block_cancel`    |

### `claim_job`

- **Signer:** `machine` (pays its `MachineStats` rent the first time).
- **Accounts:** `config` (`!paused`); `job` (mut, seeds); `usdc_mint`; `machine_token` (must exist and be the
  machine's USDC ATA: `associated_token::authority = machine`); `machine_stats` (`init_if_needed`, PDA
  `["machine", machine]`); `token_program`, `system_program`.
- **Handler:** status `Open`; `now < deadline`; `machine ≠ poster`; `machine ≠ previous_worker` (the machine that
  last left the job can't take it back); `Proven { min_accepted }` ⇒ `machine_stats.accepted ≥ min_accepted`;
  `Allowlist` ⇒ machine in `allowlist`.
- **Effect:** `worker = machine`, `claimed_at = now`, status `Claimed`. No money moves.
- **Event:** `JobClaimed`.

| Check (§13 must-fail in bold)                                                                | Test                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sets worker, creates stats paid by the machine                                               | `claim_sets_the_worker_and_creates_machine_stats_paid_by_the_machine`, `a_second_claim_reuses_machine_stats`                                                                                                                                   |
| **claim own job**                                                                            | `claim_own_job_fails`                                                                                                                                                                                                                          |
| **claim when paused**                                                                        | `claim_when_paused_fails`, `pause_blocks_claim_job`                                                                                                                                                                                            |
| **claim after deadline** (and at it)                                                         | `claim_after_deadline_fails`                                                                                                                                                                                                                   |
| **claim with `Proven` below the bar**                                                        | `claim_with_proven_below_the_bar_fails`; passes: `proven_machine_with_enough_accepted_jobs_claims`, `a_machine_with_an_accepted_job_passes_a_proven_bar`                                                                                       |
| **claim not on the allowlist**                                                               | `claim_not_on_the_allowlist_fails`; passes: `allowlisted_machine_claims`                                                                                                                                                                       |
| **claim without a USDC ATA**                                                                 | `claim_without_a_usdc_ata_fails`                                                                                                                                                                                                               |
| the USDC account is the machine's ATA                                                        | `claim_with_a_usdc_account_that_is_not_the_ata_fails`, `claim_with_someone_elses_ata_fails`                                                                                                                                                    |
| stats are the machine's own (can't borrow a veteran's record)                                | `claim_with_another_machines_stats_fails`                                                                                                                                                                                                      |
| only `Open` jobs                                                                             | `claim_a_claimed_job_fails`                                                                                                                                                                                                                    |
| not the machine that last left (unclaim or expiry; also in the same transaction); others may | `unclaim_then_reclaim_by_the_same_machine_fails`, `unclaim_and_reclaim_in_one_transaction_fails`, `squatter_expires_and_reclaims_in_one_tx_fails`, `expire_then_reclaim_by_the_same_machine_fails`, `only_the_last_machine_to_leave_is_barred` |
| USDC mint, classic token program                                                             | `claim_with_a_different_mint_than_config_fails`, `claim_with_wrong_token_program_fails`                                                                                                                                                        |

### `unclaim_job`

- **Signer:** `machine`, which must be `job.worker`.
- **Handler:** status `Claimed`; `worker == machine`.
- **Effect:** `previous_worker = machine`, `worker = None`, `claimed_at = 0`, status `Open`. **Event:** `JobUnclaimed`.
  Works while paused.

| Check                                                                        | Test                                                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| reopens; records `previous_worker`; another machine can claim; nothing moves | `claim_unclaim_then_claim_by_another`                                  |
| only the job's machine                                                       | `unclaim_by_another_machine_fails`                                     |
| only while `Claimed` (not `Open`, not `Delivered`)                           | `unclaim_an_open_job_fails`, `unclaim_or_expire_while_delivered_fails` |
| after the deadline, unclaim then refund                                      | `unclaim_after_the_deadline_reopens_and_the_poster_is_refunded`        |

### `expire_claim`

- **Signer:** none (permissionless; the fee payer signs the transaction).
- **Handler:** status `Claimed`; `claim_window > 0`; `now > claimed_at + hold`, where `hold = claim_window`, or
  `max(claim_window, MIN_RESUBMIT)` once the job has had a delivery.
- **Effect:** as `unclaim_job` (`previous_worker` = the machine whose claim expired). **Event:** `ClaimExpired`.

| Check                                                                                     | Test                                                                  |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| anyone expires after the window (not at it); job reopens                                  | `claim_with_claim_window_then_anyone_expires_the_claim`               |
| needs a claim window (unreachable since `post_job` refuses 0; the check stays as a guard) | `post_without_a_claim_window_fails`                                   |
| not before the window ends                                                                | `expire_claim_before_the_window_ends_fails`                           |
| only `Claimed` jobs                                                                       | `expire_an_open_job_fails`, `unclaim_or_expire_while_delivered_fails` |
| after a rejection the machine keeps the job ≥ 24 h                                        | `reject_restarts_the_claim_window_with_at_least_min_resubmit`         |

### `submit_delivery(delivery_hash)`

- **Signer:** `machine`, which must be `job.worker`.
- **Handler:** status `Claimed`; `worker == machine`; `now ≤ deadline`; `deliveries < 3`; `delivery_hash ≠ 0`.
- **Effect:** stores the hash, `delivered_at = now`, `deliveries += 1`, status `Delivered`.
  **Event:** `DeliverySubmitted { attempt }`. Works while paused.

| Check (§13 must-fail in bold)                 | Test                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| records the delivery                          | `post_claim_deliver_accept_pays_exactly`, `reject_then_redeliver_then_accept`                                                                                                                                                                                                                                 |
| **deliver by another machine**                | `deliver_by_another_machine_fails`                                                                                                                                                                                                                                                                            |
| **deliver after deadline** (at it is allowed) | `deliver_after_deadline_fails`, `deliver_at_the_deadline_succeeds`                                                                                                                                                                                                                                            |
| **a 4th delivery**                            | `fourth_delivery_fails` (`TooManyDeliveries`; a job `Claimed` with 3 deliveries is forced, since the instructions never leave one), `after_three_rejected_deliveries_the_job_is_closed_and_takes_no_fourth` (the real path: the third rejection refunds and closes the job, so a 4th delivery finds no `job`) |
| one delivery at a time                        | `deliver_twice_without_a_review_fails`                                                                                                                                                                                                                                                                        |
| only claimed jobs                             | `deliver_on_an_open_job_fails`                                                                                                                                                                                                                                                                                |
| hash present                                  | `deliver_a_zero_hash_fails`                                                                                                                                                                                                                                                                                   |

### `accept_delivery`

- **Signer:** `poster` (`has_one = poster`).
- **Accounts:** `config`; `job` (mut, seeds, `close = poster`); `machine` (`job.worker == Some(machine)`);
  `machine_stats` (PDA of `machine`); `usdc_mint`; `vault` (ATA of `job`); `machine_token` (USDC ATA of `machine`);
  `treasury` (`address = config.treasury`, `dup`); `token_program`.
- **Handler:** status `Delivered` (no time limit).
- **Effect (§4.5, `pay_machine`):** `reward − fee` (+ any extra in the vault) → machine's ATA; `fee` → treasury (skipped
  when 0; waived, i.e. 0, when the treasury is this job's own vault); `accepted += 1`, `earned += reward − fee` (never
  the extra); vault closed → poster; job closed → poster. `JobPaid.to_machine` is the amount sent.
- **Event:** `JobPaid { auto: false }`. Works while paused.

### `release_after_review`

- **Signer:** none (permissionless). `poster` is an unchecked account constrained by `has_one = poster`, so rent can
  only go to the poster.
- **Accounts:** as `accept_delivery`.
- **Handler:** status `Delivered`; `now > delivered_at + review_window`.
- **Effect:** the same `pay_machine`. **Event:** `JobPaid { auto: true }`. Works while paused.

Both payout instructions, every substitution tested against **both** (`payout_guards.rs` runs each case twice):

| Check (§13 must-fail in bold)                                                                                                           | Test                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| exact payout and balances, accept                                                                                                       | `post_claim_deliver_accept_pays_exactly` (poster −120, machine +117, treasury +3, poster's rent back, stats)        |
| exact payout and balances, auto-release (not at the window's end, after it)                                                             | `post_claim_deliver_no_answer_then_anyone_releases_after_review` (80 → 78 + 2)                                      |
| **accept by a non-poster** (stranger, the machine itself)                                                                               | `accept_by_non_poster_fails`                                                                                        |
| **release before the window ends**                                                                                                      | `release_before_the_review_window_ends_fails`                                                                       |
| only `Delivered`                                                                                                                        | `accept_before_a_delivery_fails`, `release_without_a_delivery_fails`                                                |
| **payout to an ATA of a different owner**                                                                                               | `payout_to_an_ata_of_a_different_owner_fails`                                                                       |
| **payout to an ATA of a different mint**                                                                                                | `payout_to_an_ata_of_a_different_mint_fails`                                                                        |
| payout to a non-ATA USDC account of the machine                                                                                         | `payout_to_a_usdc_account_of_the_machine_that_is_not_its_ata_fails`                                                 |
| payout to a machine other than the worker                                                                                               | `payout_to_a_machine_other_than_the_worker_fails`                                                                   |
| **fee to a non-treasury account**                                                                                                       | `fee_to_a_non_treasury_account_fails`                                                                               |
| **a different mint than `Config.usdc_mint`**                                                                                            | `payout_with_a_different_mint_than_config_fails`                                                                    |
| **wrong token program**                                                                                                                 | `payout_with_wrong_token_program_fails`                                                                             |
| stats credited to the right machine                                                                                                     | `payout_crediting_another_machines_stats_fails`                                                                     |
| vault is this job's                                                                                                                     | `payout_from_a_vault_that_is_not_the_jobs_fails`                                                                    |
| rent only to the poster                                                                                                                 | `release_with_rent_sent_to_someone_other_than_the_poster_fails`                                                     |
| late accept and post-deadline release still pay the machine                                                                             | `accept_after_the_review_window_still_pays_if_nobody_released`, `release_after_the_deadline_still_pays_the_machine` |
| treasury = machine's ATA doesn't trap funds                                                                                             | `payout_when_the_treasury_is_the_machines_own_ata_succeeds`                                                         |
| a donation can't block the payout, and isn't counted as `earned`                                                                        | `a_donation_to_the_vault_goes_to_the_machine_and_does_not_block_the_payout`, `donations_cannot_inflate_earned`      |
| a closed treasury ATA blocks the payout (`AccountNotInitialized` on `treasury`) only until anyone re-creates it in the same transaction | `a_closed_treasury_blocks_the_payout_until_anyone_recreates_it`                                                     |
| a treasury that is this job's own vault: fee 0, the machine gets the whole reward                                                       | `payout_when_the_treasury_is_this_jobs_own_vault_waives_the_fee`                                                    |
| zero fee                                                                                                                                | `a_zero_fee_pays_the_whole_reward_and_leaves_the_treasury_alone`                                                    |
| split for many rewards and fees, on-chain                                                                                               | `payout_splits_every_reward_exactly_on_chain`                                                                       |

### `reject_delivery(reason_hash)`

- **Signer:** `poster` (`has_one = poster`).
- **Accounts:** `config`; `job` (mut, seeds); `machine` (`== job.worker`); `machine_stats` (PDA of `machine`);
  `usdc_mint`; `vault`; `poster_token` (poster's USDC ATA); `token_program`.
- **Handler:** status `Delivered`; `now ≤ delivered_at + review_window`; `reason_hash ≠ 0`.
- **Effect:** `machine_stats.rejected += 1`. If `deliveries == 3`: `refund_poster`, vault and job closed → poster.
  Otherwise: status `Claimed` (the machine keeps the job), `claimed_at = now`, and
  `deadline = max(deadline, now + 24 h)`.
- **Events:** `DeliveryRejected { reason_hash, refunded }`, plus `JobRefunded` on the last delivery. Works while paused.

| Check (§13 must-fail in bold)                                                  | Test                                                                                      |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| back to `Claimed`, machine keeps it, redelivers, accepted                      | `reject_then_redeliver_then_accept`                                                       |
| three rejections → refund and close, exact balances                            | `three_rejections_refund_the_poster_and_close_the_job`                                    |
| **reject after the review window** (at its end is allowed)                     | `reject_after_the_review_window_fails`, `reject_at_the_end_of_the_review_window_succeeds` |
| only the poster                                                                | `reject_by_non_poster_fails`                                                              |
| a reason is required                                                           | `reject_without_a_reason_fails`                                                           |
| only `Delivered`                                                               | `reject_before_a_delivery_fails`                                                          |
| deadline moves to now + 24 h if closer (and the poster can't refund before it) | `reject_moves_a_close_deadline_to_now_plus_min_resubmit`                                  |
| a far deadline stays                                                           | `reject_keeps_a_deadline_that_is_already_far_enough`                                      |
| claim restarts and holds ≥ 24 h                                                | `reject_restarts_the_claim_window_with_at_least_min_resubmit`                             |

### `refund_after_deadline`

- **Signer:** none (permissionless). `poster` is constrained by `has_one = poster`.
- **Accounts:** `config`; `job` (mut, seeds, `close = poster`); `usdc_mint`; `vault`; `poster_token` (poster's USDC
  ATA); `token_program`.
- **Handler:** status ≠ `Delivered` (a delivery waiting for review protects the machine); `now > deadline`.
- **Effect:** `refund_poster`; vault and job closed → poster. No fee. **Event:** `JobRefunded { deliveries }`. Works
  while paused.

| Check (§13 must-fail in bold)                                               | Test                                                                                                     |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| open job, past the deadline, anyone refunds; exact balances                 | `post_no_claim_deadline_then_anyone_refunds`                                                             |
| claimed job, past the deadline                                              | `claimed_job_is_refunded_after_the_deadline`                                                             |
| **refund before the deadline** (and at it)                                  | `refund_before_deadline_fails`                                                                           |
| **refund while `Delivered`** (even past the deadline and the review window) | `refund_while_delivered_fails`, `release_after_the_deadline_still_pays_the_machine`                      |
| refund goes to the poster's ATA; rent to the poster                         | `refund_to_a_token_account_that_is_not_the_posters_fails`, `refund_with_rent_sent_to_someone_else_fails` |
| USDC mint, classic token program                                            | `refund_with_a_different_mint_than_config_fails`, `refund_with_wrong_token_program_fails`                |
| a donation can't block it                                                   | `a_donation_to_the_vault_does_not_block_refund`                                                          |

## Compute

Every instruction fits the default 200 000 CU budget, so clients need no compute-budget instruction
(`every_instruction_fits_the_default_compute_budget`, LiteSVM, CU with event CPIs). The cost depends on how many
bumps the PDA and ATA derivations try, which depends on the (random) test keys, so the table gives the range over ten
runs (after the Nov 12 fixes):

| Instruction                                                                                |   CU, min – max |
| ------------------------------------------------------------------------------------------ | --------------: |
| `post_job` (allowlist of 10)                                                               | 43 437 – 67 437 |
| `reject_delivery` (third: refund + close)                                                  | 26 902 – 38 902 |
| `accept_delivery`                                                                          | 28 802 – 36 302 |
| `release_after_review`                                                                     | 30 252 – 36 252 |
| `claim_job` (first, creates stats)                                                         | 20 947 – 29 947 |
| `refund_after_deadline`                                                                    | 19 362 – 29 862 |
| `reject_delivery`                                                                          | 21 252 – 28 752 |
| `cancel_job`                                                                               | 19 379 – 28 398 |
| `initialize_config`                                                                        | 17 352 – 23 352 |
| `claim_job` (stats exist)                                                                  | 17 157 – 23 157 |
| `update_config` (with a new treasury)                                                      |  9 595 – 15 595 |
| others (`submit_delivery`, `unclaim_job`, `expire_claim`, `propose_admin`, `accept_admin`) |         < 8 200 |

## What this program does not protect against (residual risks)

These are known and accepted for v1, or need the owner's decision.

1. **Upgrade authority.** The program is upgradeable (§4.7). Whoever holds the upgrade authority can replace the code,
   including the rules above. A Squads multisig is recommended; making the program immutable is the owner's call.
2. **Circle can freeze USDC accounts.** USDC's mint has a freeze authority. A frozen vault, machine ATA, poster ATA or
   treasury makes the transfers that touch it fail until it's thawed. Nothing in the program can route around that.
3. **The admin can't take payouts, and can stall them only through Circle-level events.** Payouts send the fee to
   the _current_ `config.treasury`, which is always the USDC ATA of `config.treasury_owner`: if it is closed, anyone
   re-creates it in the payout's transaction. A treasury owner can't be an existing job (or any account of this
   program). If the admin names a job PDA that doesn't exist yet, that job's own payout waives the fee; after the job
   closes, fees sent to that PDA's re-created ATA can't be moved by anyone (the admin's own loss, never a machine's or
   a poster's). Refunds don't touch the treasury. The admin can't redirect a machine's share or a poster's refund.
4. **Closed ATAs.** If a machine or poster closes its USDC ATA after claiming or posting, or the treasury owner closes
   the treasury, the payout or refund that needs it fails until someone re-creates the ATA (anyone can, for a little
   rent). The keeper does **not** re-create them: whoever closed an account would get the rent back each time, so a
   machine could drain the keeper by closing and re-opening. It skips the job and logs why; the account's owner
   re-creates it, and the next tick (or anyone) sends the instruction (DECISIONS, "M3 — keeper").
5. **Vault front-running is harmless.** Anyone can create a job's vault ATA before `post_job` lands (its address is
   predictable from poster + `job_id`); `post_job` then uses it (`init_if_needed`) after checking it is the job's clean
   USDC ATA. USDC already in it is treated like any donation: it leaves with the job and never counts as reward or
   `earned`. The creator's rent goes to the poster when the job closes.
6. **Dishonest posters** can reject good work and keep the result (§4.6). The program bounds it: a public reason hash,
   at least 24 h to redeliver, at most 3 deliveries, and no refund while a delivery is waiting for review.
7. **No dispute path** in v1 (§4.6, §16).
8. **Rejected-machine hold is per job.** A machine that claims after another machine's rejected deliveries inherits
   the job's delivery count and the 24 h minimum hold; that is generous to it, never unsafe for funds.
9. **Squatting with several keys.** `Job.previous_worker` remembers one machine, so a squatter that holds two keys can
   still take turns (`[expire_claim, claim_job]` with the other key) and keep a job with a claim window from honest
   machines until its deadline. (Until Nov 13, `claim_window = 0` let any machine hold a job until the deadline by design; that is gone.) Either
   way the poster gets a full refund after the deadline; what is lost is time. A claim bond or removing
   `claim_window = 0` would address it (open items below).
10. **`Proven` can be farmed.** A machine can reach `Proven { min_accepted: 5 }` by posting five 1-USDC jobs from a
    second wallet and accepting itself: 125,000 base units (0.125 USDC) in fees, one transaction per job (measured in
    the review). `Proven` is a hint, like the poster record (§4.6). Making it harder is open (below).
11. **Not done:** fuzzing, formal verification, a test on `solana-test-validator`, an external audit. The suite runs in
    LiteSVM with the same SPL Token and ATA programs it ships with.

## Review findings (Nov 12)

A review of the M2 build on Nov 12 (internal, like this document; not an audit) wrote attack tests against it. Each
finding, what changed, and the tests that now prove it. Error codes 6000–6033 are unchanged; the new errors are appended
(6034–6039). **No event layout changed** (only the docs of `JobPaid.to_machine` and `JobPaid.fee`); `Config`, `Job`
and the accounts of `initialize_config` and `update_config` did change, so the client was regenerated.

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                           | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | **Claim squatting.** The machine holding a claim could renew it forever with `[expire_claim, claim_job]` or `[unclaim_job, claim_job]` in one transaction, so honest machines never got the job and the poster couldn't cancel a claimed job.                                                                                                                                                     | New `Job.previous_worker: Option<Pubkey>`, set by `unclaim_job` and `expire_claim`; `claim_job` refuses that machine with `CannotReclaim` (6034). Another machine can still claim.                                                                                                                                                                                                                                                                                                                                                                                          | `unclaim_then_reclaim_by_the_same_machine_fails`, `unclaim_and_reclaim_in_one_transaction_fails`, `squatter_expires_and_reclaims_in_one_tx_fails` (the reviewer's attack), `expire_then_reclaim_by_the_same_machine_fails`, `only_the_last_machine_to_leave_is_barred`                                                                                                                                                                                                                                                                     |
| B   | **`earned` inflation.** A donation to a vault was added to the machine's payout and to `MachineStats.earned`, so a machine could buy any `earned` figure.                                                                                                                                                                                                                                         | The extra still goes to the machine's ATA (the vault must be empty to close) and `JobPaid.to_machine` is still the amount sent, but `earned` grows by `reward − fee` only.                                                                                                                                                                                                                                                                                                                                                                                                  | `a_donation_to_the_vault_goes_to_the_machine_and_does_not_block_the_payout` (now asserts `earned` = 117), `donations_cannot_inflate_earned`                                                                                                                                                                                                                                                                                                                                                                                                |
| C   | **Treasury liveness.** The treasury could be any USDC token account: once closed (or if it was a non-ATA account) every `accept_delivery` and `release_after_review` failed and, since refunds are impossible while `Delivered`, the money was stuck until the admin acted. A treasury equal to a job's vault blocked that job's payout (the fee stayed in the vault, which then couldn't close). | `Config.treasury_owner: Pubkey` added; the treasury must be its USDC ATA (classic SPL Token, `config.usdc_mint`), checked by `check_treasury` in `initialize_config` and `update_config` (`TreasuryNotOwnerAta`, 6035); a treasury owner owned by this program is refused (`TreasuryOwnerIsProgramAccount`, 6036); `update_config` takes `new_treasury_owner` and `new_treasury` together (`TreasuryOwnerAndAtaRequired`, 6037). Anyone can re-create a closed treasury with `CreateIdempotent` before a payout. If the treasury is the job's own vault, the fee is waived. | `a_closed_treasury_blocks_the_payout_until_anyone_recreates_it`, `payout_when_the_treasury_is_this_jobs_own_vault_waives_the_fee`, `update_config_with_a_job_as_treasury_owner_fails`, `update_config_with_the_config_as_treasury_owner_fails`, `initialize_config_with_a_program_owned_treasury_owner_fails`, `*_treasury_that_is_not_the_owners_ata_fails`, `*_someone_elses_ata_as_treasury_fails`, `update_config_with_an_ata_whose_token_owner_was_changed_fails`, `update_config_with_only_one_of_treasury_owner_and_treasury_fails` |
| D   | **`propose_admin(Pubkey::default())`** was accepted (harmless until accepted, but a typo'd client could send it).                                                                                                                                                                                                                                                                                 | Refused with `InvalidNewAdmin` (6038).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `propose_admin_of_the_default_address_fails`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| E   | **Vault front-run.** Anyone could create the job PDA's USDC ATA first; `post_job` (`init`) then failed with `IllegalOwner`, so a griefer could block a poster's chosen `job_id`.                                                                                                                                                                                                                  | The vault is `init_if_needed`: an existing account must be the job PDA's USDC ATA (Anchor: address, mint, owner, token program) with no delegate or close authority (`VaultHasDelegateOrCloseAuthority`, 6039). Exactly `reward` is transferred; an earlier balance is treated as a donation.                                                                                                                                                                                                                                                                               | `post_succeeds_when_someone_created_the_vault_first` (the reviewer's attack now posts), `a_vault_created_first_pays_the_machine_the_reward_minus_fee_as_earned`, `post_with_an_existing_vault_that_has_a_delegate_fails`, `post_with_an_existing_vault_that_has_a_close_authority_fails`, `post_with_an_existing_vault_owned_by_someone_else_fails`                                                                                                                                                                                        |
| F   | **Weak must-fail tests.** `post_with_a_vault_that_is_not_the_jobs_ata_fails` passed on the runtime's `MissingAccount`; four tests only asserted `is_err()`; `fourth_delivery_fails` passed on `AccountNotInitialized` without touching the cap.                                                                                                                                                   | Each now asserts the exact error and, where a code is ambiguous, its cause: `ConstraintTokenOwner` on `vault`; System Program "already in use" for `post_same_job_id_twice_fails` and `initialize_config_twice_fails`; SPL Token `InsufficientFunds` for `post_more_than_the_poster_holds_fails`; `AccountNotInitialized` on `job` for `cancel_twice_fails`. `fourth_delivery_fails` now proves `TooManyDeliveries`; the closed-job path is its own test.                                                                                                                   | `post_with_a_vault_that_is_not_the_jobs_ata_fails`, `post_with_a_vault_address_that_is_not_the_jobs_ata_fails`, `post_same_job_id_twice_fails`, `post_more_than_the_poster_holds_fails`, `cancel_twice_fails`, `initialize_config_twice_fails`, `fourth_delivery_fails`, `after_three_rejected_deliveries_the_job_is_closed_and_takes_no_fourth`                                                                                                                                                                                           |

Confirmed and unchanged: a machine that claims after another machine's rejected deliveries inherits the job's delivery
count (residual 8).

**Open, for the owner** (not changed; each is a product decision):

**Decided (Nov 13; the owner left these to the developer):**

- **`claim_window = 0` is removed.** `post_job` now requires a claim window from 1 h up to the time left before the
  deadline (`ClaimWindowOutOfRange`), so every claim lapses. A poster who wants a claim to hold until the deadline sets
  the full term. The SDK and the API default to 24 h, or what fits before the deadline less 10 minutes, never under
  1 h (`defaultClaimWindow`). Tests: `post_without_a_claim_window_fails`,
  `post_claim_window_one_hour_and_up_to_the_deadline_succeed`; the API refuses 0 before building
  (apps/web/test/api.int.test.ts). `expire_claim` keeps its `claim_window > 0` check as a guard.
- **No claim bond in v1.** It would cost honest machines a deposit and a second token flow on every claim. Squatting
  with several keys still costs only time (residual 9), and the poster's full refund is never at risk. A v2 candidate.
- **`Proven` stays a hint.** No on-chain rule can tell a machine's second wallet from a stranger, so a reward floor or
  "distinct posters" only raises the price of faking. The FAQ says it is a hint, like the poster record (residual 10).
- **Cancelling a pending admin proposal needs no new instruction:** the admin proposes itself. A later proposal
  replaces an earlier one, and the mistaken key can no longer accept. The mistaken key can still accept until then,
  so check the address before proposing.

## For M5 (owner)

- Re-verify `USDC_MINT` against Circle (`constants.rs`, `TODO(verify)`).
- Replace the program id (`declare_id!`, `Anchor.toml`, `TODO(M5)`) with the owner's, rebuild, regenerate the client.
- The key that deploys (the upgrade authority) must sign `initialize_config` and becomes the admin; it can hand the admin
  role to another key with `propose_admin` + `accept_admin`.
- `initialize_config(250, 1_000_000)` with `treasury_owner` = the wallet or multisig of the owner's choosing and
  `treasury` = its USDC ATA, which must already exist (create it first; ATA creation is permissionless).
- Turning on the keeper (a separate "go"): it never pays rent, so it doesn't pre-create a missing USDC account (residual
  risk 4); it skips that job until the account's owner re-creates it.
