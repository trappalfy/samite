//! Every account in the payout is constrained (CLAUDE.md §4.5): vault authority = job PDA; machine ATA owner =
//! `job.worker` and mint = USDC; treasury = `config.treasury`; rent to `job.poster`. Each substitution must fail,
//! for both `accept_delivery` and `release_after_review`.
mod common;

use anchor_lang::{error::ErrorCode, prelude::Pubkey};
use common::*;
use samite_escrow::{error::EscrowError, instruction, USDC_MINT};
use solana_keypair::Keypair;
use solana_signer::Signer;

const H1: [u8; 32] = [0xA1; 32];

struct Delivered {
    env: Env,
    poster: Keypair,
    machine: Keypair,
    job: Pubkey,
}

/// A job delivered and past its review window, so both accept and release are otherwise valid.
fn delivered() -> Delivered {
    let mut env = Env::new();
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let p = JobParams::default();
    let job = env.post(&poster, &p);
    env.claim(&machine, &job);
    env.deliver(&machine, &job, H1);
    env.advance(p.review_window + 1);
    Delivered { env, poster, machine, job }
}

/// Runs the same account substitution against accept and release; both must fail with `check`.
fn both_fail(
    edit: impl Fn(&mut Env, &mut Pubkey, &mut Pubkey, &mut Pubkey, &mut Pubkey, &mut Pubkey, &mut Pubkey),
    check: impl Fn(litesvm::types::TransactionResult),
) {
    for accept in [true, false] {
        let Delivered { mut env, poster, machine, job } = delivered();
        let res = if accept {
            let mut a = env.accept_accounts(&poster.pubkey(), &machine.pubkey(), &job);
            edit(
                &mut env,
                &mut a.machine,
                &mut a.machine_token,
                &mut a.treasury,
                &mut a.usdc_mint,
                &mut a.token_program,
                &mut a.machine_stats,
            );
            env.send(&[ix(a, instruction::AcceptDelivery {})], &[&poster])
        } else {
            let mut a = env.release_accounts(&poster.pubkey(), &machine.pubkey(), &job);
            edit(
                &mut env,
                &mut a.machine,
                &mut a.machine_token,
                &mut a.treasury,
                &mut a.usdc_mint,
                &mut a.token_program,
                &mut a.machine_stats,
            );
            env.send(&[ix(a, instruction::ReleaseAfterReview {})], &[])
        };
        check(res);
        assert_eq!(env.token_balance(&usdc_ata(&job)), 120 * USDC, "nothing left the vault");
    }
}

#[test]
fn payout_to_an_ata_of_a_different_owner_fails() {
    both_fail(
        |env, _machine, machine_token, _t, _m, _tp, _s| {
            let thief = env.funded(0);
            *machine_token = usdc_ata(&thief.pubkey());
        },
        |res| assert_anchor_err(res, ErrorCode::ConstraintTokenOwner),
    );
}

#[test]
fn payout_to_an_ata_of_a_different_mint_fails() {
    both_fail(
        |env, machine, machine_token, _t, _m, _tp, _s| {
            let fake_mint = Pubkey::new_unique();
            env.write_mint(fake_mint, 6);
            let owner = *machine;
            *machine_token = env.create_ata(&owner, &fake_mint);
        },
        |res| assert_anchor_err(res, ErrorCode::ConstraintAssociated),
    );
}

#[test]
fn payout_to_a_usdc_account_of_the_machine_that_is_not_its_ata_fails() {
    both_fail(
        |env, machine, machine_token, _t, _m, _tp, _s| {
            let other = Pubkey::new_unique();
            env.write_token_account(other, USDC_MINT, *machine, 0);
            *machine_token = other;
        },
        |res| assert_anchor_err(res, ErrorCode::ConstraintAssociated),
    );
}

#[test]
fn payout_to_a_machine_other_than_the_worker_fails() {
    both_fail(
        |env, machine, machine_token, _t, _m, _tp, stats| {
            let thief = env.funded(0);
            env.write_stats(&thief.pubkey(), 0);
            *machine = thief.pubkey();
            *machine_token = usdc_ata(&thief.pubkey());
            *stats = stats_pda(&thief.pubkey());
        },
        |res| assert_escrow_err(res, EscrowError::WrongMachine),
    );
}

#[test]
fn fee_to_a_non_treasury_account_fails() {
    both_fail(
        |env, _machine, _mt, treasury, _m, _tp, _s| {
            let thief = env.funded(0);
            *treasury = usdc_ata(&thief.pubkey());
        },
        |res| assert_escrow_err(res, EscrowError::WrongTreasury),
    );
}

#[test]
fn payout_with_a_different_mint_than_config_fails() {
    both_fail(
        |env, _machine, _mt, _t, mint, _tp, _s| {
            let fake_mint = Pubkey::new_unique();
            env.write_mint(fake_mint, 6);
            *mint = fake_mint;
        },
        |res| assert_escrow_err(res, EscrowError::WrongMint),
    );
}

#[test]
fn payout_with_wrong_token_program_fails() {
    both_fail(
        |_env, _machine, _mt, _t, _m, token_program, _s| *token_program = TOKEN_2022_PROGRAM,
        |res| assert_anchor_err(res, ErrorCode::InvalidProgramId),
    );
}

#[test]
fn payout_crediting_another_machines_stats_fails() {
    both_fail(
        |env, _machine, _mt, _t, _m, _tp, stats| {
            let other = env.funded(0);
            env.write_stats(&other.pubkey(), 0);
            *stats = stats_pda(&other.pubkey());
        },
        |res| assert_anchor_err(res, ErrorCode::ConstraintSeeds),
    );
}

#[test]
fn release_with_rent_sent_to_someone_other_than_the_poster_fails() {
    let Delivered { mut env, poster, machine, job } = delivered();
    let thief = env.funded(0);
    let mut accs = env.release_accounts(&poster.pubkey(), &machine.pubkey(), &job);
    accs.poster = thief.pubkey();
    let res = env.send(&[ix(accs, instruction::ReleaseAfterReview {})], &[]);
    assert_escrow_err(res, EscrowError::NotThePoster);
}

#[test]
fn payout_from_a_vault_that_is_not_the_jobs_fails() {
    // Another job's vault (same poster): the ATA constraint ties the vault to this job's PDA.
    let Delivered { mut env, poster, machine, job } = delivered();
    let other_job = env.post(&poster, &JobParams { job_id: 99, ..Default::default() });
    let mut accs = env.accept_accounts(&poster.pubkey(), &machine.pubkey(), &job);
    accs.vault = usdc_ata(&other_job);
    let res = env.send(&[ix(accs, instruction::AcceptDelivery {})], &[&poster]);
    assert_anchor_err(res, ErrorCode::ConstraintTokenOwner);
    assert_eq!(env.token_balance(&usdc_ata(&other_job)), 120 * USDC);
}

// ------------------------------------------------------------------ payouts that must not be blocked

#[test]
fn payout_when_the_treasury_is_the_machines_own_ata_succeeds() {
    // Two mutable references to one token account in the payout; Anchor's duplicate check must not trap the funds.
    let Delivered { mut env, poster, machine, job } = delivered();
    let admin = env.admin.insecure_clone();
    assert_ok(env.try_update_config(&admin, None, None, None, Some(machine.pubkey())));
    assert_eq!(env.config().treasury, usdc_ata(&machine.pubkey()));
    assert_ok(env.try_release(&poster.pubkey(), &machine.pubkey(), &job));
    assert_eq!(env.usdc(&machine.pubkey()), 120 * USDC, "117 as the machine + 3 as the treasury");
}

#[test]
fn a_donation_to_the_vault_goes_to_the_machine_and_does_not_block_the_payout() {
    let Delivered { mut env, poster, machine, job } = delivered();
    env.donate(&usdc_ata(&job), 5 * USDC);
    let meta = assert_ok(env.try_accept(&poster, &machine.pubkey(), &job));
    assert_eq!(env.usdc(&machine.pubkey()), 122 * USDC, "the vault is emptied into the machine's ATA");
    assert_eq!(env.token_balance(&env.treasury.clone()), 3 * USDC, "the fee is on the reward only");
    assert!(!env.exists(&usdc_ata(&job)));
    let paid: Vec<samite_escrow::events::JobPaid> = events(&meta);
    assert_eq!((paid[0].to_machine, paid[0].fee), (122 * USDC, 3 * USDC), "to_machine is what was sent");
    assert_eq!(env.stats(&machine.pubkey()).earned, 117 * USDC, "earned counts reward - fee only, never a donation");
}

#[test]
fn donations_cannot_inflate_earned() {
    // Review finding (Nov 12): a donation used to be added to `earned`, so a machine's record could be bought.
    let Delivered { mut env, poster, machine, job } = delivered();
    env.donate(&usdc_ata(&job), 1_000_000 * USDC);
    assert_ok(env.try_release(&poster.pubkey(), &machine.pubkey(), &job));
    let stats = env.stats(&machine.pubkey());
    assert_eq!((stats.accepted, stats.earned), (1, 117 * USDC));
}

#[test]
fn a_closed_treasury_blocks_the_payout_until_anyone_recreates_it() {
    // The treasury is the USDC ATA of `treasury_owner`, so if its owner closes it, anyone can re-create it in the same
    // transaction as the payout (the keeper prepends CreateIdempotent).
    for accept in [true, false] {
        let Delivered { mut env, poster, machine, job } = delivered();
        let owner = env.treasury_owner.insecure_clone();
        let close = spl_token_interface::instruction::close_account(
            &TOKEN_PROGRAM,
            &env.treasury,
            &owner.pubkey(),
            &owner.pubkey(),
            &[],
        )
        .unwrap();
        assert_ok(env.send(&[close], &[&owner]));
        assert!(!env.exists(&env.treasury.clone()));

        let payout = if accept {
            ix(env.accept_accounts(&poster.pubkey(), &machine.pubkey(), &job), instruction::AcceptDelivery {})
        } else {
            ix(env.release_accounts(&poster.pubkey(), &machine.pubkey(), &job), instruction::ReleaseAfterReview {})
        };
        let signers: Vec<&Keypair> = if accept { vec![&poster] } else { vec![] };
        assert_anchor_err_on(
            env.send(std::slice::from_ref(&payout), &signers),
            ErrorCode::AccountNotInitialized,
            "treasury",
        );
        assert_eq!(env.token_balance(&usdc_ata(&job)), 120 * USDC);

        let recreate = env.create_ata_idempotent_ix(&owner.pubkey(), &USDC_MINT);
        assert_ok(env.send(&[recreate, payout], &signers));
        assert_eq!(env.usdc(&machine.pubkey()), 117 * USDC);
        assert_eq!(env.token_balance(&env.treasury.clone()), 3 * USDC);
        assert!(!env.exists(&job));
    }
}

#[test]
fn payout_when_the_treasury_is_this_jobs_own_vault_waives_the_fee() {
    // The admin can name a job PDA that doesn't exist yet as the treasury owner (only existing program accounts are
    // refused). Its ATA is then that job's vault; its payout must still close the vault, so the fee is waived and the
    // machine gets the whole reward.
    for accept in [true, false] {
        let mut env = Env::new();
        let poster = env.funded(500 * USDC);
        let machine = env.funded(0);
        let p = JobParams::default();
        let job = job_pda(&poster.pubkey(), p.job_id);
        let admin = env.admin.insecure_clone();
        env.create_ata(&job, &USDC_MINT); // anyone can create the future vault (and the admin must, to set it)
        assert_ok(env.try_update_config(&admin, None, None, None, Some(job)));
        assert_eq!(env.config().treasury, usdc_ata(&job));

        env.post(&poster, &p);
        env.claim(&machine, &job);
        env.deliver(&machine, &job, H1);
        env.advance(p.review_window + 1);
        let meta = if accept {
            assert_ok(env.try_accept(&poster, &machine.pubkey(), &job))
        } else {
            assert_ok(env.try_release(&poster.pubkey(), &machine.pubkey(), &job))
        };
        assert_eq!(env.usdc(&machine.pubkey()), 120 * USDC, "no fee: the machine gets the whole reward");
        assert!(!env.exists(&job) && !env.exists(&usdc_ata(&job)), "vault and job closed");
        let paid: Vec<samite_escrow::events::JobPaid> = events(&meta);
        assert_eq!((paid[0].reward, paid[0].to_machine, paid[0].fee), (120 * USDC, 120 * USDC, 0));
        assert_eq!(env.stats(&machine.pubkey()).earned, 120 * USDC);
    }
}

#[test]
fn a_new_treasury_receives_fees_from_then_on() {
    let Delivered { mut env, poster, machine, job } = delivered();
    let admin = env.admin.insecure_clone();
    let multisig = env.wallet();
    let new_treasury = env.create_ata(&multisig.pubkey(), &USDC_MINT);
    let old_treasury = env.treasury;
    assert_ok(env.try_update_config(&admin, None, None, None, Some(multisig.pubkey())));
    assert_eq!((env.config().treasury_owner, env.config().treasury), (multisig.pubkey(), new_treasury));
    // The old treasury is no longer accepted.
    let mut accs = env.accept_accounts(&poster.pubkey(), &machine.pubkey(), &job);
    accs.treasury = old_treasury;
    assert_escrow_err(env.send(&[ix(accs, instruction::AcceptDelivery {})], &[&poster]), EscrowError::WrongTreasury);
    assert_ok(env.try_accept(&poster, &machine.pubkey(), &job));
    assert_eq!(env.token_balance(&new_treasury), 3 * USDC);
    assert_eq!(env.token_balance(&old_treasury), 0);
}

// ------------------------------------------------------------------ the fee is a snapshot

#[test]
fn a_fee_change_applies_to_new_jobs_only() {
    let mut env = Env::new();
    let poster = env.funded(1_000 * USDC);
    let machine = env.funded(0);
    let old = env.post(&poster, &JobParams { job_id: 1, ..Default::default() });
    env.set_fee(500);
    let new = env.post(&poster, &JobParams { job_id: 2, ..Default::default() });
    assert_eq!((env.job(&old).fee_bps, env.job(&new).fee_bps), (250, 500));

    for job in [old, new] {
        env.claim(&machine, &job);
        env.deliver(&machine, &job, H1);
        assert_ok(env.try_accept(&poster, &machine.pubkey(), &job));
    }
    // old: 117 + 3; new: 114 + 6.
    assert_eq!(env.usdc(&machine.pubkey()), 231 * USDC);
    assert_eq!(env.token_balance(&env.treasury.clone()), 9 * USDC);
}

#[test]
fn a_zero_fee_pays_the_whole_reward_and_leaves_the_treasury_alone() {
    let mut env = Env::new();
    env.set_fee(0);
    let poster = env.funded(500 * USDC);
    let machine = env.funded(0);
    let job = env.post(&poster, &JobParams::default());
    env.claim(&machine, &job);
    env.deliver(&machine, &job, H1);
    assert_ok(env.try_accept(&poster, &machine.pubkey(), &job));
    assert_eq!(env.usdc(&machine.pubkey()), 120 * USDC);
    assert_eq!(env.token_balance(&env.treasury.clone()), 0);
}
