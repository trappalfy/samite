//! submit_delivery, accept_delivery, reject_delivery, release_after_review (CLAUDE.md §4.3, §4.5, §13).
//! Every happy path checks exact balances: poster, machine, treasury, vault, and rent returned to the poster.
mod common;

use anchor_lang::error::ErrorCode;
use common::*;
use samite_escrow::{
    error::EscrowError,
    events::{DeliveryRejected, DeliverySubmitted, JobPaid, JobRefunded},
    state::{ClaimPolicy, JobStatus},
};
use solana_keypair::Keypair;
use solana_signer::Signer;

const H1: [u8; 32] = [0xA1; 32];
const H2: [u8; 32] = [0xA2; 32];
const H3: [u8; 32] = [0xA3; 32];
const REASON: [u8; 32] = [0xEE; 32];

/// Balances that matter, before and after.
struct Book {
    poster_usdc: u64,
    poster_lamports: u64,
    machine_usdc: u64,
    machine_lamports: u64,
    treasury_usdc: u64,
}

fn book(env: &Env, poster: &Keypair, machine: &Keypair) -> Book {
    Book {
        poster_usdc: env.usdc(&poster.pubkey()),
        poster_lamports: env.lamports(&poster.pubkey()),
        machine_usdc: env.usdc(&machine.pubkey()),
        machine_lamports: env.lamports(&machine.pubkey()),
        treasury_usdc: env.token_balance(&env.treasury),
    }
}

/// A poster with 500 USDC, a machine with a USDC ATA (and its MachineStats already created by an earlier claim
/// elsewhere, so the book below sees no rent move for it), and one posted + claimed job.
fn claimed_job(env: &mut Env, p: &JobParams) -> (Keypair, Keypair, anchor_lang::prelude::Pubkey) {
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let job = env.post(&poster, p);
    env.claim(&machine, &job);
    (poster, machine, job)
}

// ------------------------------------------------------------------ happy paths (§13)

#[test]
fn post_claim_deliver_accept_pays_exactly() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let start = book(&env, &poster, &machine);

    let job = env.post(&poster, &JobParams::default());
    env.claim(&machine, &job);
    env.advance(HOUR);
    let meta = assert_ok(env.try_deliver(&machine, &job, H1));
    let state = env.job(&job);
    assert_eq!(
        (state.status, state.delivery_hash, state.deliveries, state.delivered_at),
        (JobStatus::Delivered, H1, 1, START + HOUR)
    );
    let delivered: Vec<DeliverySubmitted> = events(&meta);
    assert_eq!((delivered[0].attempt, delivered[0].delivery_hash, delivered[0].machine), (1, H1, machine.pubkey()));

    let meta = assert_ok(env.try_accept(&poster, &machine.pubkey(), &job));

    let end = book(&env, &poster, &machine);
    assert_eq!(end.poster_usdc, start.poster_usdc - 120 * USDC);
    assert_eq!(end.machine_usdc, start.machine_usdc + 117 * USDC, "97.5%");
    assert_eq!(end.treasury_usdc, start.treasury_usdc + 3 * USDC, "2.5%");
    assert_eq!(end.poster_lamports, start.poster_lamports, "job + vault rent returned to the poster");
    assert_eq!(end.machine_lamports, start.machine_lamports - env.stats_rent(), "only the machine's own stats rent");
    assert!(!env.exists(&job), "job closed");
    assert!(!env.exists(&usdc_ata(&job)), "vault closed");

    let stats = env.stats(&machine.pubkey());
    assert_eq!((stats.accepted, stats.rejected, stats.earned), (1, 0, 117 * USDC));
    let paid: Vec<JobPaid> = events(&meta);
    assert_eq!(paid.len(), 1);
    assert_eq!(
        (paid[0].reward, paid[0].to_machine, paid[0].fee, paid[0].auto),
        (120 * USDC, 117 * USDC, 3 * USDC, false)
    );
    assert_eq!((paid[0].job, paid[0].poster, paid[0].machine), (job, poster.pubkey(), machine.pubkey()));
}

#[test]
fn post_claim_deliver_no_answer_then_anyone_releases_after_review() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let start = book(&env, &poster, &machine);
    let p = JobParams { reward: 80 * USDC, ..Default::default() };
    let job = env.post(&poster, &p);
    env.claim(&machine, &job);
    env.deliver(&machine, &job, H1);

    env.advance(p.review_window); // exactly at the end of the window: the poster may still answer
    assert_escrow_err(env.try_release(&poster.pubkey(), &machine.pubkey(), &job), EscrowError::ReviewWindowNotPassed);
    env.advance(1);
    let meta = assert_ok(env.try_release(&poster.pubkey(), &machine.pubkey(), &job));

    let end = book(&env, &poster, &machine);
    assert_eq!(end.poster_usdc, start.poster_usdc - 80 * USDC);
    assert_eq!(end.machine_usdc, 78 * USDC);
    assert_eq!(end.treasury_usdc, 2 * USDC);
    assert_eq!(end.poster_lamports, start.poster_lamports, "rent back to the poster, not to the caller");
    assert!(!env.exists(&job) && !env.exists(&usdc_ata(&job)));
    let stats = env.stats(&machine.pubkey());
    assert_eq!((stats.accepted, stats.earned), (1, 78 * USDC), "auto-release counts as accepted");
    let paid: Vec<JobPaid> = events(&meta);
    assert_eq!((paid[0].to_machine, paid[0].fee, paid[0].auto), (78 * USDC, 2 * USDC, true));
}

#[test]
fn reject_then_redeliver_then_accept() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let start = book(&env, &poster, &machine);
    let job = env.post(&poster, &JobParams::default());
    env.claim(&machine, &job);
    env.deliver(&machine, &job, H1);
    env.advance(HOUR);

    let meta = assert_ok(env.try_reject(&poster, &machine.pubkey(), &job, REASON));
    let state = env.job(&job);
    assert_eq!((state.status, state.worker, state.deliveries), (JobStatus::Claimed, Some(machine.pubkey()), 1));
    assert_eq!(env.stats(&machine.pubkey()).rejected, 1);
    let rejected: Vec<DeliveryRejected> = events(&meta);
    assert_eq!((rejected[0].reason_hash, rejected[0].attempt, rejected[0].refunded), (REASON, 1, false));
    assert_eq!(env.token_balance(&usdc_ata(&job)), 120 * USDC, "a rejection moves no money");

    env.advance(HOUR);
    env.deliver(&machine, &job, H2);
    let state = env.job(&job);
    assert_eq!((state.status, state.delivery_hash, state.deliveries), (JobStatus::Delivered, H2, 2));
    assert_ok(env.try_accept(&poster, &machine.pubkey(), &job));

    let end = book(&env, &poster, &machine);
    assert_eq!(end.poster_usdc, start.poster_usdc - 120 * USDC);
    assert_eq!(end.machine_usdc, 117 * USDC);
    assert_eq!(end.treasury_usdc, 3 * USDC);
    assert_eq!(end.poster_lamports, start.poster_lamports);
    let stats = env.stats(&machine.pubkey());
    assert_eq!((stats.accepted, stats.rejected, stats.earned), (1, 1, 117 * USDC));
}

#[test]
fn three_rejections_refund_the_poster_and_close_the_job() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let start = book(&env, &poster, &machine);
    let job = env.post(&poster, &JobParams::default());
    env.claim(&machine, &job);

    for (i, hash) in [H1, H2].into_iter().enumerate() {
        env.deliver(&machine, &job, hash);
        env.reject(&poster, &machine.pubkey(), &job, REASON);
        assert_eq!(env.job(&job).deliveries, i as u8 + 1);
    }
    env.deliver(&machine, &job, H3);
    let meta = assert_ok(env.try_reject(&poster, &machine.pubkey(), &job, REASON));

    let end = book(&env, &poster, &machine);
    assert_eq!(end.poster_usdc, start.poster_usdc, "full reward back");
    assert_eq!(end.poster_lamports, start.poster_lamports, "all rent back");
    assert_eq!(end.machine_usdc, 0);
    assert_eq!(end.treasury_usdc, 0, "no fee on a refund");
    assert!(!env.exists(&job) && !env.exists(&usdc_ata(&job)));
    assert_eq!(env.stats(&machine.pubkey()).rejected, 3);
    let rejected: Vec<DeliveryRejected> = events(&meta);
    assert_eq!((rejected[0].attempt, rejected[0].refunded), (3, true));
    let refunded: Vec<JobRefunded> = events(&meta);
    assert_eq!((refunded[0].refunded, refunded[0].deliveries), (120 * USDC, 3));
}

#[test]
fn a_machine_with_an_accepted_job_passes_a_proven_bar() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let first = env.post(&poster, &JobParams { job_id: 1, ..Default::default() });
    let proven = env
        .post(&poster, &JobParams { job_id: 2, policy: ClaimPolicy::Proven { min_accepted: 1 }, ..Default::default() });
    assert_escrow_err(env.try_claim(&machine, &proven), EscrowError::NotProven);
    env.claim(&machine, &first);
    env.deliver(&machine, &first, H1);
    assert_ok(env.try_accept(&poster, &machine.pubkey(), &first));
    env.claim(&machine, &proven);
}

#[test]
fn accept_after_the_review_window_still_pays_if_nobody_released() {
    let mut env = Env::new();
    let (poster, machine, job) = claimed_job(&mut env, &JobParams::default());
    env.deliver(&machine, &job, H1);
    env.advance(10 * DAY); // past the review window and the deadline
    assert_ok(env.try_accept(&poster, &machine.pubkey(), &job));
    assert_eq!(env.usdc(&machine.pubkey()), 117 * USDC);
}

#[test]
fn release_after_the_deadline_still_pays_the_machine() {
    let mut env = Env::new();
    let (poster, machine, job) =
        claimed_job(&mut env, &JobParams { deadline_in: 2 * HOUR, review_window: 48 * HOUR, ..Default::default() });
    env.deliver(&machine, &job, H1);
    env.advance(49 * HOUR);
    assert_escrow_err(env.try_refund(&poster.pubkey(), &job), EscrowError::RefundWhileDelivered);
    assert_ok(env.try_release(&poster.pubkey(), &machine.pubkey(), &job));
    assert_eq!(env.usdc(&machine.pubkey()), 117 * USDC);
}

// ------------------------------------------------------------------ rejections give the machine a fair chance

#[test]
fn reject_moves_a_close_deadline_to_now_plus_min_resubmit() {
    let mut env = Env::new();
    let (poster, machine, job) = claimed_job(&mut env, &JobParams { deadline_in: 2 * HOUR, ..Default::default() });
    env.deliver(&machine, &job, H1);
    env.advance(HOUR);
    let meta = assert_ok(env.try_reject(&poster, &machine.pubkey(), &job, REASON));
    let now = env.now();
    assert_eq!(env.job(&job).deadline, now + DAY);
    let rejected: Vec<DeliveryRejected> = events(&meta);
    assert_eq!(rejected[0].deadline, now + DAY);

    // The original deadline has passed, yet the machine can still deliver, and the poster can't refund.
    env.advance(DAY - 1);
    assert_escrow_err(env.try_refund(&poster.pubkey(), &job), EscrowError::DeadlineNotPassed);
    env.deliver(&machine, &job, H2);
}

#[test]
fn reject_keeps_a_deadline_that_is_already_far_enough() {
    let mut env = Env::new();
    let p = JobParams { deadline_in: 5 * DAY, ..Default::default() };
    let (poster, machine, job) = claimed_job(&mut env, &p);
    let deadline = env.job(&job).deadline;
    env.deliver(&machine, &job, H1);
    env.reject(&poster, &machine.pubkey(), &job, REASON);
    assert_eq!(env.job(&job).deadline, deadline);
}

#[test]
fn reject_restarts_the_claim_window_with_at_least_min_resubmit() {
    let mut env = Env::new();
    let (poster, machine, job) =
        claimed_job(&mut env, &JobParams { claim_window: 2 * HOUR, deadline_in: 5 * DAY, ..Default::default() });
    env.advance(HOUR);
    env.deliver(&machine, &job, H1);
    env.advance(4 * HOUR); // long past claimed_at + claim_window
    env.reject(&poster, &machine.pubkey(), &job, REASON);
    let rejected_at = env.now();
    assert_eq!(env.job(&job).claimed_at, rejected_at);

    env.advance(DAY); // exactly MIN_RESUBMIT after the rejection: the claim still holds
    assert_escrow_err(env.try_expire(&job), EscrowError::ClaimWindowNotPassed);
    env.advance(1);
    assert_ok(env.try_expire(&job));
    assert_eq!(env.job(&job).status, JobStatus::Open);
}

// ------------------------------------------------------------------ must-fail (§13)

#[test]
fn deliver_by_another_machine_fails() {
    let mut env = Env::new();
    let (poster, machine, job) = claimed_job(&mut env, &JobParams::default());
    let other = env.funded(0);
    assert_escrow_err(env.try_deliver(&other, &job, H1), EscrowError::NotTheWorker);
    assert_escrow_err(env.try_deliver(&poster, &job, H1), EscrowError::NotTheWorker);
    assert_eq!(env.job(&job).deliveries, 0);
    let _ = machine;
}

#[test]
fn deliver_after_deadline_fails() {
    let mut env = Env::new();
    let p = JobParams::default();
    let (_poster, machine, job) = claimed_job(&mut env, &p);
    env.advance(p.deadline_in + 1);
    assert_escrow_err(env.try_deliver(&machine, &job, H1), EscrowError::DeadlinePassed);
}

#[test]
fn deliver_at_the_deadline_succeeds() {
    let mut env = Env::new();
    let p = JobParams::default();
    let (_poster, machine, job) = claimed_job(&mut env, &p);
    env.advance(p.deadline_in);
    env.deliver(&machine, &job, H1);
}

#[test]
fn fourth_delivery_fails() {
    // The cap itself: a job Claimed with MAX_DELIVERIES deliveries refuses another one. The instructions never leave a
    // job in that state (the third rejection refunds and closes it, see the next test), so the state is forced here.
    let mut env = Env::new();
    let (_poster, machine, job) = claimed_job(&mut env, &JobParams::default());
    let mut state = env.job(&job);
    state.deliveries = 3;
    env.write_job(&job, &state);
    assert_escrow_err(env.try_deliver(&machine, &job, H1), EscrowError::TooManyDeliveries);
    assert_eq!(env.job(&job).deliveries, 3);
}

#[test]
fn after_three_rejected_deliveries_the_job_is_closed_and_takes_no_fourth() {
    let mut env = Env::new();
    let (poster, machine, job) = claimed_job(&mut env, &JobParams::default());
    for hash in [H1, H2] {
        env.deliver(&machine, &job, hash);
        env.reject(&poster, &machine.pubkey(), &job, REASON);
    }
    env.deliver(&machine, &job, H3);
    // Just before the third rejection the cap is reached: the job is Delivered with 3 deliveries.
    assert_eq!((env.job(&job).status, env.job(&job).deliveries), (JobStatus::Delivered, 3));
    env.reject(&poster, &machine.pubkey(), &job, REASON);
    assert!(!env.exists(&job) && !env.exists(&usdc_ata(&job)), "the third rejection refunded and closed the job");
    assert_anchor_err_on(env.try_deliver(&machine, &job, [0xA4; 32]), ErrorCode::AccountNotInitialized, "job");
}

#[test]
fn deliver_twice_without_a_review_fails() {
    let mut env = Env::new();
    let (_poster, machine, job) = claimed_job(&mut env, &JobParams::default());
    env.deliver(&machine, &job, H1);
    assert_escrow_err(env.try_deliver(&machine, &job, H2), EscrowError::JobNotClaimed);
}

#[test]
fn deliver_on_an_open_job_fails() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let job = env.post(&poster, &JobParams::default());
    assert_escrow_err(env.try_deliver(&machine, &job, H1), EscrowError::JobNotClaimed);
}

#[test]
fn deliver_a_zero_hash_fails() {
    let mut env = Env::new();
    let (_poster, machine, job) = claimed_job(&mut env, &JobParams::default());
    assert_escrow_err(env.try_deliver(&machine, &job, [0; 32]), EscrowError::DeliveryHashMissing);
}

#[test]
fn accept_by_non_poster_fails() {
    let mut env = Env::new();
    let (_poster, machine, job) = claimed_job(&mut env, &JobParams::default());
    env.deliver(&machine, &job, H1);
    let stranger = env.funded(0);
    for signer in [&stranger, &machine] {
        let accs = env.accept_accounts(&signer.pubkey(), &machine.pubkey(), &job);
        let res = env.send(&[ix(accs, samite_escrow::instruction::AcceptDelivery {})], &[signer]);
        assert_escrow_err(res, EscrowError::NotThePoster);
    }
    assert_eq!(env.token_balance(&usdc_ata(&job)), 120 * USDC);
}

#[test]
fn accept_before_a_delivery_fails() {
    let mut env = Env::new();
    let (poster, machine, job) = claimed_job(&mut env, &JobParams::default());
    assert_escrow_err(env.try_accept(&poster, &machine.pubkey(), &job), EscrowError::JobNotDelivered);
}

#[test]
fn reject_after_the_review_window_fails() {
    let mut env = Env::new();
    let p = JobParams::default();
    let (poster, machine, job) = claimed_job(&mut env, &p);
    env.deliver(&machine, &job, H1);
    env.advance(p.review_window + 1);
    assert_escrow_err(env.try_reject(&poster, &machine.pubkey(), &job, REASON), EscrowError::ReviewWindowPassed);
}

#[test]
fn reject_at_the_end_of_the_review_window_succeeds() {
    let mut env = Env::new();
    let p = JobParams::default();
    let (poster, machine, job) = claimed_job(&mut env, &p);
    env.deliver(&machine, &job, H1);
    env.advance(p.review_window);
    env.reject(&poster, &machine.pubkey(), &job, REASON);
}

#[test]
fn reject_by_non_poster_fails() {
    let mut env = Env::new();
    let (_poster, machine, job) = claimed_job(&mut env, &JobParams::default());
    env.deliver(&machine, &job, H1);
    let stranger = env.funded(0);
    let accs = env.reject_accounts(&stranger.pubkey(), &machine.pubkey(), &job);
    let res = env.send(&[ix(accs, samite_escrow::instruction::RejectDelivery { reason_hash: REASON })], &[&stranger]);
    assert_escrow_err(res, EscrowError::NotThePoster);
}

#[test]
fn reject_without_a_reason_fails() {
    let mut env = Env::new();
    let (poster, machine, job) = claimed_job(&mut env, &JobParams::default());
    env.deliver(&machine, &job, H1);
    assert_escrow_err(env.try_reject(&poster, &machine.pubkey(), &job, [0; 32]), EscrowError::ReasonHashMissing);
}

#[test]
fn reject_before_a_delivery_fails() {
    let mut env = Env::new();
    let (poster, machine, job) = claimed_job(&mut env, &JobParams::default());
    assert_escrow_err(env.try_reject(&poster, &machine.pubkey(), &job, REASON), EscrowError::JobNotDelivered);
}

#[test]
fn release_before_the_review_window_ends_fails() {
    let mut env = Env::new();
    let (poster, machine, job) = claimed_job(&mut env, &JobParams::default());
    env.deliver(&machine, &job, H1);
    env.advance(HOUR);
    assert_escrow_err(env.try_release(&poster.pubkey(), &machine.pubkey(), &job), EscrowError::ReviewWindowNotPassed);
}

#[test]
fn release_without_a_delivery_fails() {
    let mut env = Env::new();
    let (poster, machine, job) = claimed_job(&mut env, &JobParams::default());
    env.advance(10 * DAY);
    assert_escrow_err(env.try_release(&poster.pubkey(), &machine.pubkey(), &job), EscrowError::JobNotDelivered);
}

#[test]
fn refund_while_delivered_fails() {
    let mut env = Env::new();
    let p = JobParams { review_window: 7 * DAY, ..Default::default() };
    let (poster, machine, job) = claimed_job(&mut env, &p);
    env.deliver(&machine, &job, H1);
    env.advance(p.deadline_in + 1); // past the deadline, still inside the review window
    assert_escrow_err(env.try_refund(&poster.pubkey(), &job), EscrowError::RefundWhileDelivered);
    env.advance(7 * DAY);
    assert_escrow_err(env.try_refund(&poster.pubkey(), &job), EscrowError::RefundWhileDelivered);
}

#[test]
fn unclaim_or_expire_while_delivered_fails() {
    let mut env = Env::new();
    let (_poster, machine, job) = claimed_job(&mut env, &JobParams { claim_window: HOUR, ..Default::default() });
    env.deliver(&machine, &job, H1);
    env.advance(2 * HOUR);
    assert_escrow_err(env.try_unclaim(&machine, &job), EscrowError::JobNotClaimed);
    assert_escrow_err(env.try_expire(&job), EscrowError::JobNotClaimed);
}
