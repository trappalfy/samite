//! Pause (CLAUDE.md §4.1, §13): blocks post_job and claim_job only. Everything else still works, so pausing can
//! never trap money.
mod common;

use common::*;
use samite_escrow::{error::EscrowError, state::JobStatus};
use solana_signer::Signer;

const H1: [u8; 32] = [0xA1; 32];
const REASON: [u8; 32] = [0xEE; 32];

#[test]
fn pause_blocks_post_job() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    env.set_paused(true);
    assert_escrow_err(env.try_post(&poster, &JobParams::default()), EscrowError::Paused);
    assert_eq!(env.usdc(&poster.pubkey()), 500 * USDC);
    env.set_paused(false);
    env.post(&poster, &JobParams::default());
}

#[test]
fn pause_blocks_claim_job() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let job = env.post(&poster, &JobParams::default());
    env.set_paused(true);
    assert_escrow_err(env.try_claim(&machine, &job), EscrowError::Paused);
    assert_eq!(env.job(&job).status, JobStatus::Open);
}

#[test]
fn while_paused_cancel_unclaim_expire_deliver_accept_reject_release_and_refund_all_work() {
    let mut env = Env::new();
    let poster = env.funded(10_000 * USDC);
    let m = env.funded(0);
    let p = |id: u64| JobParams { job_id: id, claim_window: HOUR, deadline_in: 3 * DAY, ..Default::default() };

    // Set up one job per path before the pause.
    let to_cancel = env.post(&poster, &p(1));
    let to_unclaim = env.post(&poster, &p(2));
    let to_expire = env.post(&poster, &p(3));
    let to_deliver_and_accept = env.post(&poster, &p(4));
    let to_reject = env.post(&poster, &p(5));
    let to_release = env.post(&poster, &p(6));
    let to_refund = env.post(&poster, &p(7));
    for job in [to_unclaim, to_expire, to_deliver_and_accept, to_reject, to_release] {
        env.claim(&m, &job);
    }
    env.deliver(&m, &to_reject, H1);
    env.deliver(&m, &to_release, H1);

    env.set_paused(true);
    assert!(env.config().paused);

    assert_ok(env.try_cancel(&poster, &to_cancel));
    assert_ok(env.try_unclaim(&m, &to_unclaim));
    assert_ok(env.try_deliver(&m, &to_deliver_and_accept, H1));
    assert_ok(env.try_accept(&poster, &m.pubkey(), &to_deliver_and_accept));
    assert_ok(env.try_reject(&poster, &m.pubkey(), &to_reject, REASON));
    env.advance(2 * HOUR);
    assert_ok(env.try_expire(&to_expire));
    env.advance(48 * HOUR);
    assert_ok(env.try_release(&poster.pubkey(), &m.pubkey(), &to_release));
    env.advance(3 * DAY);
    assert_ok(env.try_refund(&poster.pubkey(), &to_refund));
    assert_ok(env.try_refund(&poster.pubkey(), &to_expire));
    assert_ok(env.try_refund(&poster.pubkey(), &to_unclaim));

    // Money ended where the rules say: two payouts of 117 to the machine, 3 + 3 to the treasury, the rest back.
    assert_eq!(env.usdc(&m.pubkey()), 234 * USDC);
    assert_eq!(env.token_balance(&env.treasury.clone()), 6 * USDC);
    assert_eq!(
        env.usdc(&poster.pubkey()),
        10_000 * USDC - 240 * USDC - 120 * USDC,
        "to_reject is still held, with the machine"
    );
    assert_eq!(env.job(&to_reject).status, JobStatus::Claimed);
}

#[test]
fn unpausing_restores_post_and_claim() {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    env.set_paused(true);
    env.set_paused(false);
    let job = env.post(&poster, &JobParams::default());
    env.claim(&machine, &job);
}
