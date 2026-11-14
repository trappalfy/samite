//! Property test, on-chain: for many rewards and fee levels, a full post → claim → deliver → pay cycle moves
//! exactly `to_machine` to the machine and `fee` to the treasury, with `to_machine + fee == reward` and
//! `fee == floor(reward * bps / 10_000)` (CLAUDE.md §4.5, §13). The exhaustive 1..=10,000,000 sweep of the same
//! maths runs off-chain in `settle::tests`.
mod common;

use common::*;
use samite_escrow::events::JobPaid;
use solana_signer::Signer;

/// splitmix64: a small deterministic generator, so a failure is reproducible from the printed case.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}

fn expected_fee(reward: u64, bps: u16) -> u64 {
    (u128::from(reward) * u128::from(bps) / 10_000) as u64
}

#[test]
fn payout_splits_every_reward_exactly_on_chain() {
    const SEED: u64 = 0x5A41_17E0;
    let mut rng = Rng(SEED);
    let fee_levels = [0u16, 1, 7, 250, 333, 499, 500];

    // Edge rewards first (flooring boundaries, the prototype's numbers, 1 base unit, very large), then random ones
    // across several orders of magnitude.
    let mut rewards: Vec<u64> = vec![
        1,
        2,
        39,
        40,
        399,
        400,
        9_999,
        10_000,
        10_001,
        999_999,
        1_000_000,
        1_000_039,
        80_000_000,
        120_000_000,
        10_000_000_000,
        1_000_000_000_000_000,
    ];
    for _ in 0..200 {
        let magnitude = 10u64.pow((rng.next() % 13) as u32); // 1 .. 10^12
        rewards.push(1 + rng.next() % (magnitude * 10));
    }

    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    assert_ok(env.try_update_config(&admin, None, Some(1), None, None)); // allow rewards down to 1 base unit
    let total: u64 = rewards.iter().sum();
    let poster = env.funded(total);
    let machine = env.funded(0);
    let treasury = env.treasury;

    for (i, &reward) in rewards.iter().enumerate() {
        let bps = fee_levels[(rng.next() % fee_levels.len() as u64) as usize];
        if env.config().fee_bps != bps {
            env.set_fee(bps);
        }
        let case = format!("case {i}: reward {reward}, fee_bps {bps} (seed {SEED:#x})");

        let job = env.post(&poster, &JobParams { job_id: i as u64, reward, ..Default::default() });
        env.claim(&machine, &job);
        env.deliver(&machine, &job, [0xA1; 32]);
        let machine_before = env.usdc(&machine.pubkey());
        let treasury_before = env.token_balance(&treasury);

        // Alternate accept and auto-release: both go through the same payout.
        let meta = if i % 2 == 0 {
            assert_ok(env.try_accept(&poster, &machine.pubkey(), &job))
        } else {
            env.advance(48 * HOUR + 1);
            assert_ok(env.try_release(&poster.pubkey(), &machine.pubkey(), &job))
        };

        let to_machine = env.usdc(&machine.pubkey()) - machine_before;
        let fee = env.token_balance(&treasury) - treasury_before;
        assert_eq!(to_machine + fee, reward, "{case}");
        assert_eq!(fee, expected_fee(reward, bps), "{case}");
        let paid: Vec<JobPaid> = events(&meta);
        assert_eq!((paid[0].to_machine, paid[0].fee, paid[0].reward), (to_machine, fee, reward), "{case}");
        assert!(!env.exists(&job), "{case}");
    }

    let stats = env.stats(&machine.pubkey());
    assert_eq!(stats.accepted as usize, rewards.len());
    assert_eq!(env.usdc(&poster.pubkey()), 0);
    assert_eq!(stats.earned + env.token_balance(&treasury), total, "every base unit accounted for");
}
