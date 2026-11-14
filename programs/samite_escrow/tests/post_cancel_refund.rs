//! post_job, cancel_job, refund_after_deadline on an open job (CLAUDE.md §4.3, §4.4, §13).
mod common;

use anchor_lang::{error::ErrorCode, prelude::Pubkey};
use common::*;
use samite_escrow::{
    error::EscrowError,
    events::{JobCancelled, JobPosted, JobRefunded},
    state::{ClaimPolicy, JobStatus},
};
use solana_signer::Signer;

// ------------------------------------------------------------------ happy paths

#[test]
fn post_job_locks_the_reward_and_records_the_job() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let lamports = env.lamports(&poster.pubkey());
    let p = JobParams::default();
    let deadline = env.now() + p.deadline_in;

    let meta = assert_ok(env.try_post(&poster, &p));
    let job = job_pda(&poster.pubkey(), p.job_id);

    // Exact balances: the reward moved into the vault; the poster paid exactly the two rents.
    assert_eq!(env.usdc(&poster.pubkey()), 380 * USDC);
    assert_eq!(env.token_balance(&usdc_ata(&job)), 120 * USDC);
    assert_eq!(env.lamports(&poster.pubkey()), lamports - env.job_rent() - env.vault_rent());
    assert_eq!(env.lamports(&job), env.job_rent());
    assert_eq!(env.token_balance(&env.treasury.clone()), 0);

    let state = env.job(&job);
    assert_eq!(state.poster, poster.pubkey());
    assert_eq!(state.job_id, p.job_id);
    assert_eq!(state.reward, 120 * USDC);
    assert_eq!(state.fee_bps, 250);
    assert_eq!(state.spec_hash, p.spec_hash);
    assert_eq!(state.status, JobStatus::Open);
    assert_eq!(state.worker, None);
    assert_eq!(state.previous_worker, None);
    assert_eq!(state.policy, ClaimPolicy::Any);
    assert!(state.allowlist.is_empty());
    assert_eq!(state.deadline, deadline);
    assert_eq!(state.review_window, 48 * HOUR);
    assert_eq!(state.claim_window, 3 * DAY); // the helper's default: the full term
    assert_eq!(state.delivery_hash, [0; 32]);
    assert_eq!(state.deliveries, 0);
    assert_eq!(state.created_at, START);
    assert_eq!((state.claimed_at, state.delivered_at), (0, 0));

    let posted: Vec<JobPosted> = events(&meta);
    assert_eq!(posted.len(), 1);
    assert_eq!(
        (posted[0].job, posted[0].poster, posted[0].reward, posted[0].fee_bps),
        (job, poster.pubkey(), 120 * USDC, 250)
    );
    assert_eq!((posted[0].deadline, posted[0].spec_hash), (deadline, p.spec_hash));
}

#[test]
fn post_then_cancel_returns_the_reward_and_all_rent() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let lamports = env.lamports(&poster.pubkey());
    let job = env.post(&poster, &JobParams::default());

    let meta = assert_ok(env.try_cancel(&poster, &job));

    assert_eq!(env.usdc(&poster.pubkey()), 500 * USDC, "full reward back");
    assert_eq!(env.lamports(&poster.pubkey()), lamports, "job + vault rent back");
    assert!(!env.exists(&job), "job closed");
    assert!(!env.exists(&usdc_ata(&job)), "vault closed");
    assert_eq!(env.token_balance(&env.treasury.clone()), 0, "no fee on cancel");
    let cancelled: Vec<JobCancelled> = events(&meta);
    assert_eq!((cancelled[0].job, cancelled[0].refunded), (job, 120 * USDC));
}

#[test]
fn post_no_claim_deadline_then_anyone_refunds() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let lamports = env.lamports(&poster.pubkey());
    let p = JobParams::default();
    let job = env.post(&poster, &p);

    env.advance(p.deadline_in + 1);
    let meta = assert_ok(env.try_refund(&poster.pubkey(), &job));

    assert_eq!(env.usdc(&poster.pubkey()), 500 * USDC);
    assert_eq!(env.lamports(&poster.pubkey()), lamports);
    assert!(!env.exists(&job));
    assert!(!env.exists(&usdc_ata(&job)));
    assert_eq!(env.token_balance(&env.treasury.clone()), 0, "no fee on refund");
    let refunded: Vec<JobRefunded> = events(&meta);
    assert_eq!((refunded[0].job, refunded[0].refunded, refunded[0].deliveries), (job, 120 * USDC, 0));
}

#[test]
fn a_poster_can_run_several_jobs_at_once() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let a = env.post(&poster, &JobParams { job_id: 1, ..Default::default() });
    let b = env.post(&poster, &JobParams { job_id: 2, reward: 80 * USDC, ..Default::default() });
    assert_ne!(a, b);
    assert_eq!(env.token_balance(&usdc_ata(&a)), 120 * USDC);
    assert_eq!(env.token_balance(&usdc_ata(&b)), 80 * USDC);
    assert_eq!(env.usdc(&poster.pubkey()), 300 * USDC);
    assert_ok(env.try_cancel(&poster, &a));
    assert_eq!(env.token_balance(&usdc_ata(&b)), 80 * USDC, "funds never mix");
}

#[test]
fn a_donation_to_the_vault_does_not_block_cancel() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let job = env.post(&poster, &JobParams::default());
    env.donate(&usdc_ata(&job), 1);
    assert_ok(env.try_cancel(&poster, &job));
    assert_eq!(env.usdc(&poster.pubkey()), 500 * USDC + 1, "the vault's whole balance goes back");
    assert!(!env.exists(&usdc_ata(&job)));
}

#[test]
fn a_donation_to_the_vault_does_not_block_refund() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let p = JobParams::default();
    let job = env.post(&poster, &p);
    env.donate(&usdc_ata(&job), 7 * USDC);
    env.advance(p.deadline_in + 1);
    assert_ok(env.try_refund(&poster.pubkey(), &job));
    assert_eq!(env.usdc(&poster.pubkey()), 507 * USDC);
}

// ------------------------------------------------------------------ post_job limits (§4.4)

#[test]
fn post_reward_below_min_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let res = env.try_post(&poster, &JobParams { reward: USDC - 1, ..Default::default() });
    assert_escrow_err(res, EscrowError::RewardTooSmall);
}

#[test]
fn post_reward_at_min_succeeds() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    assert_ok(env.try_post(&poster, &JobParams { reward: USDC, ..Default::default() }));
}

#[test]
fn post_deadline_sooner_than_one_hour_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let res = env.try_post(&poster, &JobParams { deadline_in: HOUR - 1, ..Default::default() });
    assert_escrow_err(res, EscrowError::DeadlineOutOfRange);
}

#[test]
fn post_deadline_in_the_past_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let res = env.try_post(&poster, &JobParams { deadline_in: -DAY, ..Default::default() });
    assert_escrow_err(res, EscrowError::DeadlineOutOfRange);
}

#[test]
fn post_deadline_later_than_90_days_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let res = env.try_post(&poster, &JobParams { deadline_in: 90 * DAY + 1, ..Default::default() });
    assert_escrow_err(res, EscrowError::DeadlineOutOfRange);
}

#[test]
fn post_deadline_at_both_bounds_succeeds() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    assert_ok(env.try_post(&poster, &JobParams { job_id: 1, deadline_in: HOUR, ..Default::default() }));
    assert_ok(env.try_post(&poster, &JobParams { job_id: 2, deadline_in: 90 * DAY, ..Default::default() }));
}

#[test]
fn post_review_window_shorter_than_one_hour_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let res = env.try_post(&poster, &JobParams { review_window: HOUR - 1, ..Default::default() });
    assert_escrow_err(res, EscrowError::ReviewWindowOutOfRange);
}

#[test]
fn post_review_window_longer_than_seven_days_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let res = env.try_post(&poster, &JobParams { review_window: 7 * DAY + 1, ..Default::default() });
    assert_escrow_err(res, EscrowError::ReviewWindowOutOfRange);
}

#[test]
fn post_review_window_at_both_bounds_succeeds() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    assert_ok(env.try_post(&poster, &JobParams { job_id: 1, review_window: HOUR, ..Default::default() }));
    assert_ok(env.try_post(&poster, &JobParams { job_id: 2, review_window: 7 * DAY, ..Default::default() }));
}

#[test]
fn post_claim_window_shorter_than_one_hour_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let res = env.try_post(&poster, &JobParams { claim_window: HOUR - 1, ..Default::default() });
    assert_escrow_err(res, EscrowError::ClaimWindowOutOfRange);
}

#[test]
fn post_negative_claim_window_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let res = env.try_post(&poster, &JobParams { claim_window: -1, ..Default::default() });
    assert_escrow_err(res, EscrowError::ClaimWindowOutOfRange);
}

#[test]
fn post_claim_window_past_the_deadline_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let res =
        env.try_post(&poster, &JobParams { deadline_in: 2 * DAY, claim_window: 2 * DAY + 1, ..Default::default() });
    assert_escrow_err(res, EscrowError::ClaimWindowOutOfRange);
}

#[test]
fn post_without_a_claim_window_fails() {
    // 0 used to mean "the claim holds until the deadline"; since Nov 13 every claim lapses
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let p = JobParams::default();
    let accs = env.post_accounts(&poster.pubkey(), p.job_id);
    let mut data = env.post_data(&p);
    data.claim_window = 0;
    assert_escrow_err(env.send(&[ix(accs, data)], &[&poster]), EscrowError::ClaimWindowOutOfRange);
}

#[test]
fn post_claim_window_one_hour_and_up_to_the_deadline_succeed() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    assert_ok(env.try_post(&poster, &JobParams { job_id: 2, claim_window: HOUR, ..Default::default() }));
    assert_ok(env.try_post(
        &poster,
        &JobParams { job_id: 3, deadline_in: 2 * DAY, claim_window: 2 * DAY, ..Default::default() },
    ));
}

#[test]
fn post_allowlist_policy_with_an_empty_list_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let res =
        env.try_post(&poster, &JobParams { policy: ClaimPolicy::Allowlist, allowlist: vec![], ..Default::default() });
    assert_escrow_err(res, EscrowError::InvalidAllowlist);
}

#[test]
fn post_allowlist_of_eleven_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let list: Vec<Pubkey> = (0..11).map(|_| Pubkey::new_unique()).collect();
    let res =
        env.try_post(&poster, &JobParams { policy: ClaimPolicy::Allowlist, allowlist: list, ..Default::default() });
    assert_escrow_err(res, EscrowError::InvalidAllowlist);
}

#[test]
fn post_allowlist_of_ten_succeeds() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let list: Vec<Pubkey> = (0..10).map(|_| Pubkey::new_unique()).collect();
    let job =
        env.post(&poster, &JobParams { policy: ClaimPolicy::Allowlist, allowlist: list.clone(), ..Default::default() });
    assert_eq!(env.job(&job).allowlist, list);
}

#[test]
fn post_list_with_a_policy_other_than_allowlist_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let list = vec![Pubkey::new_unique()];
    let res =
        env.try_post(&poster, &JobParams { policy: ClaimPolicy::Any, allowlist: list.clone(), ..Default::default() });
    assert_escrow_err(res, EscrowError::InvalidAllowlist);
    let res = env.try_post(
        &poster,
        &JobParams { policy: ClaimPolicy::Proven { min_accepted: 5 }, allowlist: list, ..Default::default() },
    );
    assert_escrow_err(res, EscrowError::InvalidAllowlist);
}

#[test]
fn post_zero_spec_hash_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let res = env.try_post(&poster, &JobParams { spec_hash: [0; 32], ..Default::default() });
    assert_escrow_err(res, EscrowError::SpecHashMissing);
}

#[test]
fn post_same_job_id_twice_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    env.post(&poster, &JobParams::default());
    // The job PDA already exists: the System Program refuses to allocate it again (AccountAlreadyInUse, 0).
    assert_cpi_err(env.try_post(&poster, &JobParams::default()), 0, "already in use");
    assert_eq!(env.usdc(&poster.pubkey()), 380 * USDC, "nothing else moved");
}

#[test]
fn post_more_than_the_poster_holds_fails() {
    let mut env = Env::new();
    let poster = env.funded(10 * USDC);
    let res = env.try_post(&poster, &JobParams { reward: 10 * USDC + 1, ..Default::default() });
    assert_cpi_err(res, spl_token_interface::error::TokenError::InsufficientFunds as u32, "insufficient funds");
    assert_eq!(env.usdc(&poster.pubkey()), 10 * USDC);
}

#[test]
fn post_with_a_different_mint_than_config_fails() {
    let mut env = Env::new();
    let poster = env.wallet();
    let fake_mint = Pubkey::new_unique();
    env.write_mint(fake_mint, 6);
    let fake_ata = env.create_ata(&poster.pubkey(), &fake_mint);
    env.mint(&fake_mint, &fake_ata, 500 * USDC);
    let p = JobParams::default();
    let mut accs = env.post_accounts(&poster.pubkey(), p.job_id);
    accs.usdc_mint = fake_mint;
    accs.poster_token = fake_ata;
    accs.vault = ata(&accs.job, &fake_mint);
    let data = env.post_data(&p);
    assert_escrow_err(env.send(&[ix(accs, data)], &[&poster]), EscrowError::WrongMint);
}

#[test]
fn post_with_wrong_token_program_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let p = JobParams::default();
    let mut accs = env.post_accounts(&poster.pubkey(), p.job_id);
    accs.token_program = TOKEN_2022_PROGRAM;
    let data = env.post_data(&p);
    assert_anchor_err(env.send(&[ix(accs, data)], &[&poster]), ErrorCode::InvalidProgramId);
}

#[test]
fn post_from_someone_elses_token_account_fails() {
    let mut env = Env::new();
    let poster = env.funded(0);
    let other = env.funded(500 * USDC);
    let p = JobParams::default();
    let mut accs = env.post_accounts(&poster.pubkey(), p.job_id);
    accs.poster_token = usdc_ata(&other.pubkey());
    let data = env.post_data(&p);
    assert_anchor_err(env.send(&[ix(accs, data)], &[&poster]), ErrorCode::ConstraintTokenOwner);
}

#[test]
fn post_with_a_vault_that_is_not_the_jobs_ata_fails() {
    // An existing USDC account that the job PDA does not own (here the poster's own ATA).
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let p = JobParams::default();
    let mut accs = env.post_accounts(&poster.pubkey(), p.job_id);
    accs.vault = usdc_ata(&poster.pubkey());
    let data = env.post_data(&p);
    assert_anchor_err_on(env.send(&[ix(accs, data)], &[&poster]), ErrorCode::ConstraintTokenOwner, "vault");
    assert_eq!(env.usdc(&poster.pubkey()), 500 * USDC);
}

#[test]
fn post_with_a_job_owned_usdc_account_that_is_not_its_ata_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let p = JobParams::default();
    let job = job_pda(&poster.pubkey(), p.job_id);
    let not_ata = Pubkey::new_unique();
    env.write_token_account(not_ata, samite_escrow::USDC_MINT, job, 0);
    let mut accs = env.post_accounts(&poster.pubkey(), p.job_id);
    accs.vault = not_ata;
    let data = env.post_data(&p);
    assert_anchor_err_on(env.send(&[ix(accs, data)], &[&poster]), ErrorCode::AccountNotAssociatedTokenAccount, "vault");
}

#[test]
fn post_with_a_vault_address_that_is_not_the_jobs_ata_fails() {
    // A fresh address: the ATA program only ever creates the vault at the job PDA's ATA address, which this
    // transaction doesn't list, so the runtime stops the CPI (MissingAccount, naming the real vault address).
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let p = JobParams::default();
    let real_vault = usdc_ata(&job_pda(&poster.pubkey(), p.job_id));
    let mut accs = env.post_accounts(&poster.pubkey(), p.job_id);
    accs.vault = Pubkey::new_unique();
    let data = env.post_data(&p);
    let res = env.send(&[ix(accs, data)], &[&poster]);
    let logs = res.as_ref().err().map(|f| f.meta.logs.join("\n")).unwrap_or_default();
    assert_ix_err(res, solana_instruction_error::InstructionError::MissingAccount);
    assert!(logs.contains(&format!("Instruction references an unknown account {real_vault}")), "{logs}");
    assert_eq!(env.usdc(&poster.pubkey()), 500 * USDC);
}

// ------------------------------------------------------------------ a vault created before post_job (review finding)

#[test]
fn post_succeeds_when_someone_created_the_vault_first() {
    // The vault's address is predictable, and anyone can create an ATA. That must not block post_job, and USDC already
    // in the vault is not part of the reward.
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let griefer = env.wallet();
    let p = JobParams::default();
    let job = job_pda(&poster.pubkey(), p.job_id);
    let create = spl_associated_token_account_interface::instruction::create_associated_token_account(
        &griefer.pubkey(),
        &job,
        &samite_escrow::USDC_MINT,
        &TOKEN_PROGRAM,
    );
    assert_ok(env.send(&[create], &[&griefer]));
    env.donate(&usdc_ata(&job), 5 * USDC);
    let lamports = env.lamports(&poster.pubkey());

    let meta = assert_ok(env.try_post(&poster, &p));

    assert_eq!(env.usdc(&poster.pubkey()), 380 * USDC, "exactly the reward moved");
    assert_eq!(env.token_balance(&usdc_ata(&job)), 125 * USDC);
    assert_eq!(env.job(&job).reward, 120 * USDC, "the earlier balance is not counted as reward");
    assert_eq!(env.lamports(&poster.pubkey()), lamports - env.job_rent(), "the vault's rent was paid by its creator");
    let posted: Vec<JobPosted> = events(&meta);
    assert_eq!(posted[0].reward, 120 * USDC);

    // Like any donation, the extra leaves with the job: here back to the poster on cancel.
    assert_ok(env.try_cancel(&poster, &job));
    assert_eq!(env.usdc(&poster.pubkey()), 505 * USDC);
    assert!(!env.exists(&usdc_ata(&job)));
}

#[test]
fn a_vault_created_first_pays_the_machine_the_reward_minus_fee_as_earned() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let p = JobParams::default();
    let job = job_pda(&poster.pubkey(), p.job_id);
    env.create_ata(&job, &samite_escrow::USDC_MINT);
    env.donate(&usdc_ata(&job), 2 * USDC);
    env.post(&poster, &p);
    env.claim(&machine, &job);
    env.deliver(&machine, &job, [0xA1; 32]);
    assert_ok(env.try_accept(&poster, &machine.pubkey(), &job));
    assert_eq!(env.usdc(&machine.pubkey()), 119 * USDC);
    assert_eq!(env.token_balance(&env.treasury.clone()), 3 * USDC);
    assert_eq!(env.stats(&machine.pubkey()).earned, 117 * USDC);
}

#[test]
fn post_with_an_existing_vault_that_has_a_delegate_fails() {
    // Only the job PDA could approve a delegate, so this can't happen on-chain; the check is defence in depth.
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let p = JobParams::default();
    let job = job_pda(&poster.pubkey(), p.job_id);
    let thief = Pubkey::new_unique();
    env.write_token_account_with(usdc_ata(&job), samite_escrow::USDC_MINT, job, 0, Some(thief), None);
    assert_escrow_err(env.try_post(&poster, &p), EscrowError::VaultHasDelegateOrCloseAuthority);
    assert_eq!(env.usdc(&poster.pubkey()), 500 * USDC);
}

#[test]
fn post_with_an_existing_vault_that_has_a_close_authority_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let p = JobParams::default();
    let job = job_pda(&poster.pubkey(), p.job_id);
    let thief = Pubkey::new_unique();
    env.write_token_account_with(usdc_ata(&job), samite_escrow::USDC_MINT, job, 0, None, Some(thief));
    assert_escrow_err(env.try_post(&poster, &p), EscrowError::VaultHasDelegateOrCloseAuthority);
}

#[test]
fn post_with_an_existing_vault_owned_by_someone_else_fails() {
    // A token account at the vault address whose owner is not the job PDA (impossible through the ATA program).
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let p = JobParams::default();
    let job = job_pda(&poster.pubkey(), p.job_id);
    env.write_token_account(usdc_ata(&job), samite_escrow::USDC_MINT, poster.pubkey(), 0);
    assert_anchor_err_on(env.try_post(&poster, &p), ErrorCode::ConstraintTokenOwner, "vault");
}

// ------------------------------------------------------------------ cancel

#[test]
fn cancel_by_non_poster_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let stranger = env.funded(0);
    let job = env.post(&poster, &JobParams::default());
    let accs = env.cancel_accounts(&stranger.pubkey(), &job);
    let res = env.send(&[ix(accs, samite_escrow::instruction::CancelJob {})], &[&stranger]);
    assert_escrow_err(res, EscrowError::NotThePoster);
    assert_eq!(env.token_balance(&usdc_ata(&job)), 120 * USDC);
}

#[test]
fn cancel_with_wrong_token_program_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let job = env.post(&poster, &JobParams::default());
    let mut accs = env.cancel_accounts(&poster.pubkey(), &job);
    accs.token_program = TOKEN_2022_PROGRAM;
    let res = env.send(&[ix(accs, samite_escrow::instruction::CancelJob {})], &[&poster]);
    assert_anchor_err(res, ErrorCode::InvalidProgramId);
}

#[test]
fn cancel_twice_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let job = env.post(&poster, &JobParams::default());
    assert_ok(env.try_cancel(&poster, &job));
    assert_anchor_err_on(env.try_cancel(&poster, &job), ErrorCode::AccountNotInitialized, "job");
    assert_eq!(env.usdc(&poster.pubkey()), 500 * USDC);
}

// ------------------------------------------------------------------ refund on an open job

#[test]
fn refund_before_deadline_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let p = JobParams::default();
    let job = env.post(&poster, &p);
    assert_escrow_err(env.try_refund(&poster.pubkey(), &job), EscrowError::DeadlineNotPassed);
    env.advance(p.deadline_in); // exactly at the deadline: still not past it
    assert_escrow_err(env.try_refund(&poster.pubkey(), &job), EscrowError::DeadlineNotPassed);
    env.advance(1);
    assert_ok(env.try_refund(&poster.pubkey(), &job));
}

#[test]
fn refund_with_rent_sent_to_someone_else_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let thief = env.funded(0);
    let p = JobParams::default();
    let job = env.post(&poster, &p);
    env.advance(p.deadline_in + 1);
    let mut accs = env.refund_accounts(&poster.pubkey(), &job);
    accs.poster = thief.pubkey();
    let res = env.send(&[ix(accs, samite_escrow::instruction::RefundAfterDeadline {})], &[]);
    assert_escrow_err(res, EscrowError::NotThePoster);
}

#[test]
fn refund_to_a_token_account_that_is_not_the_posters_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let thief = env.funded(0);
    let p = JobParams::default();
    let job = env.post(&poster, &p);
    env.advance(p.deadline_in + 1);
    let mut accs = env.refund_accounts(&poster.pubkey(), &job);
    accs.poster_token = usdc_ata(&thief.pubkey());
    let res = env.send(&[ix(accs, samite_escrow::instruction::RefundAfterDeadline {})], &[]);
    assert_anchor_err(res, ErrorCode::ConstraintTokenOwner);
    assert_eq!(env.usdc(&thief.pubkey()), 0);
}

#[test]
fn refund_with_a_different_mint_than_config_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let p = JobParams::default();
    let job = env.post(&poster, &p);
    env.advance(p.deadline_in + 1);
    let fake_mint = Pubkey::new_unique();
    env.write_mint(fake_mint, 6);
    let mut accs = env.refund_accounts(&poster.pubkey(), &job);
    accs.usdc_mint = fake_mint;
    let res = env.send(&[ix(accs, samite_escrow::instruction::RefundAfterDeadline {})], &[]);
    assert_escrow_err(res, EscrowError::WrongMint);
}

#[test]
fn refund_with_wrong_token_program_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let p = JobParams::default();
    let job = env.post(&poster, &p);
    env.advance(p.deadline_in + 1);
    let mut accs = env.refund_accounts(&poster.pubkey(), &job);
    accs.token_program = TOKEN_2022_PROGRAM;
    let res = env.send(&[ix(accs, samite_escrow::instruction::RefundAfterDeadline {})], &[]);
    assert_anchor_err(res, ErrorCode::InvalidProgramId);
}
