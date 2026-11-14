//! Every instruction fits the default 200,000 compute-unit budget, so clients never need a compute-budget
//! instruction. Run with `--nocapture` to see the numbers.
mod common;

use common::*;
use solana_signer::Signer;

const LIMIT: u64 = 200_000;

fn record(name: &str, meta: litesvm::types::TransactionMetadata, seen: &mut Vec<(String, u64)>) {
    seen.push((name.to_string(), meta.compute_units_consumed));
}

#[test]
fn every_instruction_fits_the_default_compute_budget() {
    let mut seen = Vec::new();
    let mut env = Env::bare();
    let admin = env.admin.insecure_clone();
    record("initialize_config", assert_ok(env.try_initialize_config(&admin, 250, USDC)), &mut seen);
    let treasury_owner = env.treasury_owner.pubkey();
    record(
        "update_config (with treasury)",
        assert_ok(env.try_update_config(&admin, Some(250), None, Some(false), Some(treasury_owner))),
        &mut seen,
    );
    let next = env.wallet();
    record("propose_admin", assert_ok(env.try_propose_admin(&admin, next.pubkey())), &mut seen);
    record("accept_admin", assert_ok(env.try_accept_admin(&next)), &mut seen);

    let poster = env.funded(10_000 * USDC);
    let machine = env.funded(0);
    let second = env.funded(0);
    env.write_stats(&second.pubkey(), 0);
    let allowlist: Vec<_> = (0..10).map(|_| anchor_lang::prelude::Pubkey::new_unique()).collect();
    let big =
        JobParams { job_id: 1, policy: samite_escrow::state::ClaimPolicy::Allowlist, allowlist, ..Default::default() };
    record("post_job (allowlist of 10)", assert_ok(env.try_post(&poster, &big)), &mut seen);
    let job = env.post(&poster, &JobParams { job_id: 2, claim_window: HOUR, ..Default::default() });
    record("claim_job (first, creates stats)", assert_ok(env.try_claim(&machine, &job)), &mut seen);
    record("unclaim_job", assert_ok(env.try_unclaim(&machine, &job)), &mut seen);
    record("claim_job (stats exist)", assert_ok(env.try_claim(&second, &job)), &mut seen);
    env.advance(HOUR + 1);
    record("expire_claim", assert_ok(env.try_expire(&job)), &mut seen);
    env.claim(&machine, &job); // the last machine to leave was `second`, so `machine` may claim again
    record("submit_delivery", assert_ok(env.try_deliver(&machine, &job, [1; 32])), &mut seen);
    record("reject_delivery", assert_ok(env.try_reject(&poster, &machine.pubkey(), &job, [2; 32])), &mut seen);
    env.deliver(&machine, &job, [3; 32]);
    record("accept_delivery", assert_ok(env.try_accept(&poster, &machine.pubkey(), &job)), &mut seen);

    let job = env.post(&poster, &JobParams { job_id: 3, ..Default::default() });
    env.claim(&machine, &job);
    env.deliver(&machine, &job, [1; 32]);
    env.advance(48 * HOUR + 1);
    record("release_after_review", assert_ok(env.try_release(&poster.pubkey(), &machine.pubkey(), &job)), &mut seen);

    let job = env.post(&poster, &JobParams { job_id: 4, ..Default::default() });
    for h in [[1; 32], [2; 32]] {
        env.claim_if_open(&machine, &job);
        env.deliver(&machine, &job, h);
        env.reject(&poster, &machine.pubkey(), &job, [9; 32]);
    }
    env.deliver(&machine, &job, [3; 32]);
    record(
        "reject_delivery (third: refund + close)",
        assert_ok(env.try_reject(&poster, &machine.pubkey(), &job, [9; 32])),
        &mut seen,
    );

    let job = env.post(&poster, &JobParams { job_id: 5, ..Default::default() });
    record("cancel_job", assert_ok(env.try_cancel(&poster, &job)), &mut seen);
    let job = env.post(&poster, &JobParams { job_id: 6, ..Default::default() });
    env.advance(4 * DAY);
    record("refund_after_deadline", assert_ok(env.try_refund(&poster.pubkey(), &job)), &mut seen);

    for (name, cu) in &seen {
        println!("{name:<42} {cu:>7} CU");
        assert!(*cu < LIMIT, "{name} used {cu} CU");
    }
}

trait ClaimIfOpen {
    fn claim_if_open(&mut self, machine: &solana_keypair::Keypair, job: &anchor_lang::prelude::Pubkey);
}

impl ClaimIfOpen for Env {
    fn claim_if_open(&mut self, machine: &solana_keypair::Keypair, job: &anchor_lang::prelude::Pubkey) {
        if self.job(job).status == samite_escrow::state::JobStatus::Open {
            self.claim(machine, job);
        }
    }
}
