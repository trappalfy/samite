//! claim_job, unclaim_job, expire_claim, and refunds of claimed jobs (CLAUDE.md §4.3, §13).
mod common;

use anchor_lang::{error::ErrorCode, prelude::Pubkey};
use common::*;
use samite_escrow::{
    error::EscrowError,
    events::{ClaimExpired, JobClaimed, JobRefunded, JobUnclaimed},
    state::{ClaimPolicy, JobStatus},
};
use solana_signer::Signer;

// ------------------------------------------------------------------ happy paths

#[test]
fn claim_sets_the_worker_and_creates_machine_stats_paid_by_the_machine() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let job = env.post(&poster, &JobParams::default());
    let lamports = env.lamports(&machine.pubkey());
    env.advance(HOUR);

    let meta = assert_ok(env.try_claim(&machine, &job));

    let state = env.job(&job);
    assert_eq!(state.status, JobStatus::Claimed);
    assert_eq!(state.worker, Some(machine.pubkey()));
    assert_eq!(state.claimed_at, START + HOUR);
    let stats = env.stats(&machine.pubkey());
    assert_eq!((stats.machine, stats.accepted, stats.rejected, stats.earned), (machine.pubkey(), 0, 0, 0));
    assert_eq!(env.lamports(&machine.pubkey()), lamports - env.stats_rent(), "the machine pays its stats rent");
    assert_eq!(env.token_balance(&usdc_ata(&job)), 120 * USDC, "claiming moves no money");
    let claimed: Vec<JobClaimed> = events(&meta);
    assert_eq!((claimed[0].job, claimed[0].machine, claimed[0].claimed_at), (job, machine.pubkey(), START + HOUR));
}

#[test]
fn a_second_claim_reuses_machine_stats() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let a = env.post(&poster, &JobParams { job_id: 1, ..Default::default() });
    let b = env.post(&poster, &JobParams { job_id: 2, ..Default::default() });
    env.claim(&machine, &a);
    let lamports = env.lamports(&machine.pubkey());
    env.claim(&machine, &b);
    assert_eq!(env.lamports(&machine.pubkey()), lamports, "no second rent");
    assert_eq!(env.job(&b).worker, Some(machine.pubkey()));
}

#[test]
fn claim_unclaim_then_claim_by_another() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let first = env.funded(0);
    let second = env.funded(0);
    let job = env.post(&poster, &JobParams::default());

    env.claim(&first, &job);
    env.advance(HOUR);
    let meta = assert_ok(env.try_unclaim(&first, &job));
    let state = env.job(&job);
    assert_eq!((state.status, state.worker, state.claimed_at), (JobStatus::Open, None, 0));
    assert_eq!(state.previous_worker, Some(first.pubkey()), "the machine that left is recorded");
    let unclaimed: Vec<JobUnclaimed> = events(&meta);
    assert_eq!((unclaimed[0].job, unclaimed[0].machine), (job, first.pubkey()));

    env.claim(&second, &job);
    assert_eq!(env.job(&job).worker, Some(second.pubkey()));
    // Exact balances: nothing moved for anyone.
    assert_eq!(env.token_balance(&usdc_ata(&job)), 120 * USDC);
    assert_eq!(env.usdc(&poster.pubkey()), 380 * USDC);
    assert_eq!((env.usdc(&first.pubkey()), env.usdc(&second.pubkey())), (0, 0));
}

#[test]
fn claim_with_claim_window_then_anyone_expires_the_claim() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let other = env.funded(0);
    let job = env.post(&poster, &JobParams { claim_window: 2 * HOUR, ..Default::default() });
    env.claim(&machine, &job);

    env.advance(2 * HOUR); // exactly at the end of the window: still held
    assert_escrow_err(env.try_expire(&job), EscrowError::ClaimWindowNotPassed);
    env.advance(1);
    let meta = assert_ok(env.try_expire(&job));

    let state = env.job(&job);
    assert_eq!((state.status, state.worker, state.claimed_at), (JobStatus::Open, None, 0));
    assert_eq!(state.previous_worker, Some(machine.pubkey()), "the machine whose claim expired is recorded");
    let expired: Vec<ClaimExpired> = events(&meta);
    assert_eq!((expired[0].job, expired[0].machine), (job, machine.pubkey()));
    env.claim(&other, &job);
    assert_eq!(env.job(&job).worker, Some(other.pubkey()));
    assert_eq!(env.token_balance(&usdc_ata(&job)), 120 * USDC);
}

#[test]
fn proven_machine_with_enough_accepted_jobs_claims() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    env.write_stats(&machine.pubkey(), 5);
    let job = env.post(&poster, &JobParams { policy: ClaimPolicy::Proven { min_accepted: 5 }, ..Default::default() });
    env.claim(&machine, &job);
    assert_eq!(env.job(&job).worker, Some(machine.pubkey()));
    assert_eq!(env.stats(&machine.pubkey()).accepted, 5, "existing stats are kept");
}

#[test]
fn allowlisted_machine_claims() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let list = vec![Pubkey::new_unique(), machine.pubkey(), Pubkey::new_unique()];
    let job = env.post(&poster, &JobParams { policy: ClaimPolicy::Allowlist, allowlist: list, ..Default::default() });
    env.claim(&machine, &job);
    assert_eq!(env.job(&job).worker, Some(machine.pubkey()));
}

#[test]
fn claimed_job_is_refunded_after_the_deadline() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let p = JobParams::default();
    let poster_lamports = env.lamports(&poster.pubkey());
    let job = env.post(&poster, &p);
    env.claim(&machine, &job);
    let machine_lamports = env.lamports(&machine.pubkey());

    assert_escrow_err(env.try_refund(&poster.pubkey(), &job), EscrowError::DeadlineNotPassed);
    env.advance(p.deadline_in + 1);
    let meta = assert_ok(env.try_refund(&poster.pubkey(), &job));

    assert_eq!(env.usdc(&poster.pubkey()), 500 * USDC);
    assert_eq!(env.lamports(&poster.pubkey()), poster_lamports, "job + vault rent back to the poster");
    assert_eq!(env.usdc(&machine.pubkey()), 0);
    assert_eq!(env.lamports(&machine.pubkey()), machine_lamports);
    assert_eq!(env.token_balance(&env.treasury.clone()), 0);
    assert!(!env.exists(&job));
    let refunded: Vec<JobRefunded> = events(&meta);
    assert_eq!((refunded[0].refunded, refunded[0].deliveries), (120 * USDC, 0));
}

// ------------------------------------------------------------------ claim must-fail (§13)

#[test]
fn claim_own_job_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let job = env.post(&poster, &JobParams::default());
    assert_escrow_err(env.try_claim(&poster, &job), EscrowError::PosterCannotClaim);
}

#[test]
fn claim_when_paused_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let job = env.post(&poster, &JobParams::default());
    env.set_paused(true);
    assert_escrow_err(env.try_claim(&machine, &job), EscrowError::Paused);
    env.set_paused(false);
    env.claim(&machine, &job);
}

#[test]
fn claim_after_deadline_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let p = JobParams::default();
    let job = env.post(&poster, &p);
    env.advance(p.deadline_in); // at the deadline: claims need now < deadline
    assert_escrow_err(env.try_claim(&machine, &job), EscrowError::DeadlinePassed);
    env.advance(1);
    assert_escrow_err(env.try_claim(&machine, &job), EscrowError::DeadlinePassed);
}

#[test]
fn claim_with_proven_below_the_bar_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let newcomer = env.funded(0);
    let almost = env.funded(0);
    env.write_stats(&almost.pubkey(), 4);
    let job = env.post(&poster, &JobParams { policy: ClaimPolicy::Proven { min_accepted: 5 }, ..Default::default() });
    assert_escrow_err(env.try_claim(&newcomer, &job), EscrowError::NotProven);
    assert_escrow_err(env.try_claim(&almost, &job), EscrowError::NotProven);
}

#[test]
fn claim_not_on_the_allowlist_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let list = vec![Pubkey::new_unique()];
    let job = env.post(&poster, &JobParams { policy: ClaimPolicy::Allowlist, allowlist: list, ..Default::default() });
    assert_escrow_err(env.try_claim(&machine, &job), EscrowError::NotOnAllowlist);
}

#[test]
fn claim_without_a_usdc_ata_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.wallet(); // SOL, but no USDC ATA
    let job = env.post(&poster, &JobParams::default());
    assert_anchor_err(env.try_claim(&machine, &job), ErrorCode::AccountNotInitialized);
    assert_eq!(env.job(&job).status, JobStatus::Open);
}

#[test]
fn claim_with_a_usdc_account_that_is_not_the_ata_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.wallet();
    let job = env.post(&poster, &JobParams::default());
    let not_ata = Pubkey::new_unique();
    env.write_token_account(not_ata, samite_escrow::USDC_MINT, machine.pubkey(), 0);
    let mut accs = env.claim_accounts(&machine.pubkey(), &job);
    accs.machine_token = not_ata;
    let res = env.send(&[ix(accs, samite_escrow::instruction::ClaimJob {})], &[&machine]);
    assert_anchor_err(res, ErrorCode::ConstraintAssociated);
}

#[test]
fn claim_with_someone_elses_ata_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.wallet();
    let job = env.post(&poster, &JobParams::default());
    let mut accs = env.claim_accounts(&machine.pubkey(), &job);
    accs.machine_token = usdc_ata(&poster.pubkey());
    let res = env.send(&[ix(accs, samite_escrow::instruction::ClaimJob {})], &[&machine]);
    assert_anchor_err(res, ErrorCode::ConstraintTokenOwner);
}

#[test]
fn claim_a_claimed_job_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let first = env.funded(0);
    let second = env.funded(0);
    let job = env.post(&poster, &JobParams::default());
    env.claim(&first, &job);
    assert_escrow_err(env.try_claim(&second, &job), EscrowError::JobNotOpen);
    assert_escrow_err(env.try_claim(&first, &job), EscrowError::JobNotOpen);
}

#[test]
fn claim_with_a_different_mint_than_config_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.wallet();
    let job = env.post(&poster, &JobParams::default());
    let fake_mint = Pubkey::new_unique();
    env.write_mint(fake_mint, 6);
    let fake_ata = env.create_ata(&machine.pubkey(), &fake_mint);
    let mut accs = env.claim_accounts(&machine.pubkey(), &job);
    accs.usdc_mint = fake_mint;
    accs.machine_token = fake_ata;
    let res = env.send(&[ix(accs, samite_escrow::instruction::ClaimJob {})], &[&machine]);
    assert_escrow_err(res, EscrowError::WrongMint);
}

#[test]
fn claim_with_wrong_token_program_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let job = env.post(&poster, &JobParams::default());
    let mut accs = env.claim_accounts(&machine.pubkey(), &job);
    accs.token_program = TOKEN_2022_PROGRAM;
    let res = env.send(&[ix(accs, samite_escrow::instruction::ClaimJob {})], &[&machine]);
    assert_anchor_err(res, ErrorCode::InvalidProgramId);
}

#[test]
fn claim_with_another_machines_stats_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let veteran = env.funded(0);
    env.write_stats(&veteran.pubkey(), 50);
    let job = env.post(&poster, &JobParams { policy: ClaimPolicy::Proven { min_accepted: 5 }, ..Default::default() });
    let mut accs = env.claim_accounts(&machine.pubkey(), &job);
    accs.machine_stats = stats_pda(&veteran.pubkey());
    let res = env.send(&[ix(accs, samite_escrow::instruction::ClaimJob {})], &[&machine]);
    assert_anchor_err(res, ErrorCode::ConstraintSeeds);
}

#[test]
fn cancel_a_claimed_job_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let job = env.post(&poster, &JobParams::default());
    env.claim(&machine, &job);
    assert_escrow_err(env.try_cancel(&poster, &job), EscrowError::JobNotOpen);
}

// ------------------------------------------------------------------ unclaim / expire must-fail

#[test]
fn unclaim_by_another_machine_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let other = env.funded(0);
    let job = env.post(&poster, &JobParams::default());
    env.claim(&machine, &job);
    assert_escrow_err(env.try_unclaim(&other, &job), EscrowError::NotTheWorker);
    assert_escrow_err(env.try_unclaim(&poster, &job), EscrowError::NotTheWorker);
    assert_eq!(env.job(&job).worker, Some(machine.pubkey()));
}

#[test]
fn unclaim_an_open_job_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let job = env.post(&poster, &JobParams::default());
    assert_escrow_err(env.try_unclaim(&machine, &job), EscrowError::JobNotClaimed);
}

#[test]
fn unclaim_after_the_deadline_reopens_and_the_poster_is_refunded() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let p = JobParams::default();
    let job = env.post(&poster, &p);
    env.claim(&machine, &job);
    env.advance(p.deadline_in + 1);
    assert_ok(env.try_unclaim(&machine, &job));
    assert_ok(env.try_refund(&poster.pubkey(), &job));
    assert_eq!(env.usdc(&poster.pubkey()), 500 * USDC);
}

#[test]
fn expire_claim_before_the_window_ends_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let job = env.post(&poster, &JobParams { claim_window: 6 * HOUR, ..Default::default() });
    env.claim(&machine, &job);
    env.advance(6 * HOUR - 1);
    assert_escrow_err(env.try_expire(&job), EscrowError::ClaimWindowNotPassed);
    assert_eq!(env.job(&job).worker, Some(machine.pubkey()));
}

#[test]
fn expire_an_open_job_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let job = env.post(&poster, &JobParams { claim_window: HOUR, ..Default::default() });
    env.advance(2 * HOUR);
    assert_escrow_err(env.try_expire(&job), EscrowError::JobNotClaimed);
}

// ------------------------------------------------------------------ claim squatting (review finding, Nov 12)
//
// A machine that leaves a job (unclaim_job) or whose claim expired (expire_claim) can't claim that job again, so a
// claim window can't be reset by the same key: neither in a later transaction nor in the same one.

#[test]
fn unclaim_then_reclaim_by_the_same_machine_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let other = env.funded(0);
    let job = env.post(&poster, &JobParams { claim_window: HOUR, ..Default::default() });
    env.claim(&machine, &job);
    assert_ok(env.try_unclaim(&machine, &job));

    assert_escrow_err(env.try_claim(&machine, &job), EscrowError::CannotReclaim);
    assert_eq!(env.job(&job).status, JobStatus::Open);
    env.claim(&other, &job);
    assert_eq!(env.job(&job).worker, Some(other.pubkey()), "another machine can still claim");
}

#[test]
fn unclaim_and_reclaim_in_one_transaction_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let squatter = env.funded(0);
    let job = env.post(&poster, &JobParams { claim_window: HOUR, deadline_in: 10 * DAY, ..Default::default() });
    env.claim(&squatter, &job);
    env.advance(HOUR - 1); // just before the claim window ends: reset it
    let unclaim = env.unclaim_ix(&squatter.pubkey(), &job);
    let claim = env.claim_ix(&squatter.pubkey(), &job);
    assert_escrow_err(env.send(&[unclaim, claim], &[&squatter]), EscrowError::CannotReclaim);

    let state = env.job(&job);
    assert_eq!((state.worker, state.claimed_at), (Some(squatter.pubkey()), START), "the old claim stands, unrenewed");
    env.advance(2);
    assert_ok(env.try_expire(&job));
}

#[test]
fn squatter_expires_and_reclaims_in_one_tx_fails() {
    // The reviewer's attack: the squatter sends expire_claim + claim_job the instant its claim window ends.
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let squatter = env.funded(0);
    let honest = env.funded(0);
    let job = env.post(&poster, &JobParams { claim_window: HOUR, deadline_in: 10 * DAY, ..Default::default() });
    env.claim(&squatter, &job);
    env.advance(HOUR + 1);
    let expire = env.expire_ix(&job);
    let claim = env.claim_ix(&squatter.pubkey(), &job);
    assert_escrow_err(env.send(&[expire, claim], &[&squatter]), EscrowError::CannotReclaim);
    assert_eq!(env.job(&job).worker, Some(squatter.pubkey()), "the transaction failed as a whole");

    // Anyone expires the stale claim; an honest machine claims it.
    assert_ok(env.try_expire(&job));
    env.claim(&honest, &job);
    assert_eq!(env.job(&job).worker, Some(honest.pubkey()));
}

#[test]
fn expire_then_reclaim_by_the_same_machine_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let other = env.funded(0);
    let job = env.post(&poster, &JobParams { claim_window: HOUR, ..Default::default() });
    env.claim(&machine, &job);
    env.advance(HOUR + 1);
    assert_ok(env.try_expire(&job));

    assert_escrow_err(env.try_claim(&machine, &job), EscrowError::CannotReclaim);
    env.claim(&other, &job);
    assert_eq!(env.job(&job).worker, Some(other.pubkey()));
}

#[test]
fn only_the_last_machine_to_leave_is_barred() {
    // `previous_worker` holds one address: the machine that left most recently. A machine that left earlier may claim
    // again once another machine has held and left the job. (So two keys can still take turns; see the review's open
    // items: a claim bond is the owner's call.)
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let a = env.funded(0);
    let b = env.funded(0);
    let job = env.post(&poster, &JobParams::default());
    env.claim(&a, &job);
    assert_ok(env.try_unclaim(&a, &job));
    env.claim(&b, &job);
    assert_ok(env.try_unclaim(&b, &job));
    assert_eq!(env.job(&job).previous_worker, Some(b.pubkey()));
    assert_escrow_err(env.try_claim(&b, &job), EscrowError::CannotReclaim);
    env.claim(&a, &job);
    assert_eq!(env.job(&job).worker, Some(a.pubkey()));
}
