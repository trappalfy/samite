//! initialize_config, update_config, propose_admin / accept_admin (CLAUDE.md §4.3, §4.4).
mod common;

use anchor_lang::{error::ErrorCode, prelude::Pubkey};
use common::*;
use samite_escrow::{error::EscrowError, USDC_MINT};
use solana_signer::Signer;

#[test]
fn initialize_config_sets_every_field() {
    let env = Env::new();
    let config = env.config();
    assert_eq!(config.admin, env.admin.pubkey());
    assert_eq!(config.treasury_owner, env.treasury_owner.pubkey());
    assert_eq!(config.treasury, env.treasury);
    assert_eq!(config.treasury, usdc_ata(&env.treasury_owner.pubkey()), "the treasury is the owner's USDC ATA");
    assert_eq!(config.usdc_mint, USDC_MINT);
    assert_eq!(config.fee_bps, 250);
    assert_eq!(config.min_reward, USDC);
    assert!(!config.paused);
    assert_eq!(config.pending_admin, None);
}

#[test]
fn initialize_config_by_non_upgrade_authority_fails() {
    let mut env = Env::bare();
    let stranger = env.wallet();
    assert_escrow_err(env.try_initialize_config(&stranger, 250, USDC), EscrowError::NotUpgradeAuthority);
}

#[test]
fn initialize_config_without_upgrade_authority_fails() {
    // An immutable program (no upgrade authority) can't be initialised by anyone.
    let mut env = Env::bare();
    env.set_upgrade_authority(None);
    let admin = env.admin.insecure_clone();
    assert_escrow_err(env.try_initialize_config(&admin, 250, USDC), EscrowError::NotUpgradeAuthority);
}

#[test]
fn initialize_config_with_another_programs_program_data_fails() {
    // An attacker passes a ProgramData account (of some program they control) that names them as authority.
    let mut env = Env::bare();
    let stranger = env.wallet();
    let fake_program_data = anchor_lang::prelude::Pubkey::new_unique();
    let mut data = vec![3, 0, 0, 0];
    data.extend_from_slice(&0u64.to_le_bytes());
    data.push(1);
    data.extend_from_slice(stranger.pubkey().as_ref());
    let lamports = env.rent(data.len());
    env.svm
        .set_account(
            fake_program_data,
            solana_account::Account {
                lamports,
                data,
                owner: anchor_lang::solana_program::bpf_loader_upgradeable::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    let mut accs = env.initialize_config_accounts(&stranger.pubkey());
    accs.program_data = fake_program_data;
    let res = env.send(
        &[ix(accs, samite_escrow::instruction::InitializeConfig { fee_bps: 250, min_reward: USDC })],
        &[&stranger],
    );
    assert_escrow_err(res, EscrowError::NotUpgradeAuthority);
}

#[test]
fn initialize_config_with_a_non_program_data_account_fails() {
    let mut env = Env::bare();
    let admin = env.admin.insecure_clone();
    let mut accs = env.initialize_config_accounts(&admin.pubkey());
    accs.program_data = env.treasury;
    let res = env
        .send(&[ix(accs, samite_escrow::instruction::InitializeConfig { fee_bps: 250, min_reward: USDC })], &[&admin]);
    assert_anchor_err(res, ErrorCode::AccountOwnedByWrongProgram);
}

#[test]
fn config_instructions_emit_events() {
    use samite_escrow::events::*;
    let mut env = Env::bare();
    let admin = env.admin.insecure_clone();
    let meta = assert_ok(env.try_initialize_config(&admin, 250, USDC));
    let init: Vec<ConfigInitialized> = events(&meta);
    assert_eq!(init.len(), 1);
    assert_eq!(
        (init[0].admin, init[0].treasury, init[0].fee_bps, init[0].min_reward),
        (admin.pubkey(), env.treasury, 250, USDC)
    );

    let meta = assert_ok(env.try_update_config(&admin, Some(300), None, Some(true), None));
    let updated: Vec<ConfigUpdated> = events(&meta);
    assert_eq!(updated.len(), 1);
    assert_eq!((updated[0].fee_bps, updated[0].paused, updated[0].min_reward), (300, true, USDC));

    let next = env.wallet();
    let meta = assert_ok(env.try_propose_admin(&admin, next.pubkey()));
    let proposed: Vec<AdminProposed> = events(&meta);
    assert_eq!(proposed[0].proposed, next.pubkey());
    let meta = assert_ok(env.try_accept_admin(&next));
    let accepted: Vec<AdminAccepted> = events(&meta);
    assert_eq!((accepted[0].previous, accepted[0].admin), (admin.pubkey(), next.pubkey()));
}

#[test]
fn initialize_config_twice_fails() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    // The System Program refuses to allocate the config PDA again: SystemError::AccountAlreadyInUse (0).
    assert_cpi_err(env.try_initialize_config(&admin, 250, USDC), 0, "already in use");
    assert_eq!(env.config().fee_bps, 250);
}

#[test]
fn initialize_config_with_fee_above_max_fails() {
    let mut env = Env::bare();
    let admin = env.admin.insecure_clone();
    assert_escrow_err(env.try_initialize_config(&admin, 501, USDC), EscrowError::FeeTooHigh);
}

#[test]
fn initialize_config_with_fee_at_max_succeeds() {
    let mut env = Env::bare();
    let admin = env.admin.insecure_clone();
    assert_ok(env.try_initialize_config(&admin, 500, USDC));
    assert_eq!(env.config().fee_bps, 500);
}

#[test]
fn initialize_config_with_zero_min_reward_fails() {
    let mut env = Env::bare();
    let admin = env.admin.insecure_clone();
    assert_escrow_err(env.try_initialize_config(&admin, 250, 0), EscrowError::MinRewardZero);
}

#[test]
fn initialize_config_with_a_different_mint_fails() {
    let mut env = Env::bare();
    let admin = env.admin.insecure_clone();
    let fake_mint = anchor_lang::prelude::Pubkey::new_unique();
    env.write_mint(fake_mint, 6);
    let mut accs = env.initialize_config_accounts(&admin.pubkey());
    accs.usdc_mint = fake_mint;
    accs.treasury = env.create_ata(&env.treasury_owner.pubkey(), &fake_mint);
    let res = env
        .send(&[ix(accs, samite_escrow::instruction::InitializeConfig { fee_bps: 250, min_reward: USDC })], &[&admin]);
    assert_escrow_err(res, EscrowError::WrongMint);
}

#[test]
fn initialize_config_with_a_non_usdc_treasury_fails() {
    // The owner's ATA for another mint is not the owner's USDC ATA.
    let mut env = Env::bare();
    let admin = env.admin.insecure_clone();
    let fake_mint = anchor_lang::prelude::Pubkey::new_unique();
    env.write_mint(fake_mint, 6);
    let mut accs = env.initialize_config_accounts(&admin.pubkey());
    accs.treasury = env.create_ata(&env.treasury_owner.pubkey(), &fake_mint);
    let res = env
        .send(&[ix(accs, samite_escrow::instruction::InitializeConfig { fee_bps: 250, min_reward: USDC })], &[&admin]);
    assert_escrow_err(res, EscrowError::TreasuryNotOwnerAta);
}

#[test]
fn initialize_config_with_a_treasury_that_is_not_the_owners_ata_fails() {
    // A USDC token account of the treasury owner at another address: if it were closed, nobody could re-create it.
    let mut env = Env::bare();
    let admin = env.admin.insecure_clone();
    let not_ata = anchor_lang::prelude::Pubkey::new_unique();
    env.write_token_account(not_ata, USDC_MINT, env.treasury_owner.pubkey(), 0);
    let mut accs = env.initialize_config_accounts(&admin.pubkey());
    accs.treasury = not_ata;
    let res = env
        .send(&[ix(accs, samite_escrow::instruction::InitializeConfig { fee_bps: 250, min_reward: USDC })], &[&admin]);
    assert_escrow_err(res, EscrowError::TreasuryNotOwnerAta);
}

#[test]
fn initialize_config_with_someone_elses_ata_as_treasury_fails() {
    let mut env = Env::bare();
    let admin = env.admin.insecure_clone();
    let other = env.funded(0);
    let mut accs = env.initialize_config_accounts(&admin.pubkey());
    accs.treasury = usdc_ata(&other.pubkey());
    let res = env
        .send(&[ix(accs, samite_escrow::instruction::InitializeConfig { fee_bps: 250, min_reward: USDC })], &[&admin]);
    assert_escrow_err(res, EscrowError::TreasuryNotOwnerAta);
}

#[test]
fn initialize_config_with_a_program_owned_treasury_owner_fails() {
    // An account owned by this program (in practice a Job PDA) can't own the treasury.
    let mut env = Env::bare();
    let admin = env.admin.insecure_clone();
    let program_account = anchor_lang::prelude::Pubkey::new_unique();
    let lamports = env.rent(8);
    env.svm
        .set_account(
            program_account,
            solana_account::Account {
                lamports,
                data: vec![0; 8],
                owner: program_id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    let treasury = env.create_ata(&program_account, &USDC_MINT);
    let mut accs = env.initialize_config_accounts(&admin.pubkey());
    accs.treasury_owner = program_account;
    accs.treasury = treasury;
    let res = env
        .send(&[ix(accs, samite_escrow::instruction::InitializeConfig { fee_bps: 250, min_reward: USDC })], &[&admin]);
    assert_escrow_err(res, EscrowError::TreasuryOwnerIsProgramAccount);
}

#[test]
fn initialize_config_with_wrong_token_program_fails() {
    let mut env = Env::bare();
    let admin = env.admin.insecure_clone();
    let mut accs = env.initialize_config_accounts(&admin.pubkey());
    accs.token_program = TOKEN_2022_PROGRAM;
    let res = env
        .send(&[ix(accs, samite_escrow::instruction::InitializeConfig { fee_bps: 250, min_reward: USDC })], &[&admin]);
    assert_anchor_err(res, ErrorCode::InvalidProgramId);
}

#[test]
fn update_config_changes_fee_min_reward_paused_and_treasury() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let new_owner = env.wallet();
    let new_treasury = env.create_ata(&new_owner.pubkey(), &USDC_MINT);
    assert_ok(env.try_update_config(&admin, Some(100), Some(5 * USDC), Some(true), Some(new_owner.pubkey())));
    let config = env.config();
    assert_eq!(config.fee_bps, 100);
    assert_eq!(config.min_reward, 5 * USDC);
    assert!(config.paused);
    assert_eq!((config.treasury_owner, config.treasury), (new_owner.pubkey(), new_treasury));
}

#[test]
fn update_config_with_nothing_set_changes_nothing() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let before = env.config();
    assert_ok(env.try_update_config(&admin, None, None, None, None));
    let after = env.config();
    assert_eq!(after.fee_bps, before.fee_bps);
    assert_eq!(after.min_reward, before.min_reward);
    assert_eq!(after.paused, before.paused);
    assert_eq!((after.treasury_owner, after.treasury), (before.treasury_owner, before.treasury));
}

#[test]
fn update_config_with_fee_above_max_fails() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    assert_escrow_err(env.try_update_config(&admin, Some(501), None, None, None), EscrowError::FeeTooHigh);
    assert_escrow_err(env.try_update_config(&admin, Some(u16::MAX), None, None, None), EscrowError::FeeTooHigh);
    assert_eq!(env.config().fee_bps, 250);
}

#[test]
fn update_config_by_non_admin_fails() {
    let mut env = Env::new();
    let stranger = env.wallet();
    assert_escrow_err(env.try_update_config(&stranger, Some(0), None, None, None), EscrowError::NotAdmin);
    assert_escrow_err(env.try_update_config(&stranger, None, None, Some(true), None), EscrowError::NotAdmin);
    assert_eq!(env.config().fee_bps, 250);
    assert!(!env.config().paused);
}

#[test]
fn update_config_with_zero_min_reward_fails() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    assert_escrow_err(env.try_update_config(&admin, None, Some(0), None, None), EscrowError::MinRewardZero);
}

#[test]
fn update_config_with_a_non_usdc_treasury_fails() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let fake_mint = anchor_lang::prelude::Pubkey::new_unique();
    env.write_mint(fake_mint, 6);
    let owner = env.wallet();
    let bad_treasury = env.create_ata(&owner.pubkey(), &fake_mint);
    let res = env.try_update_config_with(&admin, None, None, None, Some(owner.pubkey()), Some(bad_treasury));
    assert_escrow_err(res, EscrowError::TreasuryNotOwnerAta);
    assert_eq!(env.config().treasury, env.treasury);
}

#[test]
fn update_config_with_a_treasury_that_is_not_a_token_account_fails() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let owner = env.wallet();
    let res = env.try_update_config_with(&admin, None, None, None, Some(owner.pubkey()), Some(owner.pubkey()));
    assert_anchor_err_on(res, ErrorCode::AccountOwnedByWrongProgram, "new_treasury");
}

#[test]
fn update_config_with_a_treasury_whose_ata_does_not_exist_fails() {
    // The ATA must exist when it is set (anyone can create it first), which also proves the owner key is right.
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let owner = env.wallet();
    let res = env.try_update_config(&admin, None, None, None, Some(owner.pubkey()));
    assert_anchor_err_on(res, ErrorCode::AccountNotInitialized, "new_treasury");
}

#[test]
fn update_config_with_a_treasury_that_is_not_the_owners_ata_fails() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let owner = env.wallet();
    let not_ata = anchor_lang::prelude::Pubkey::new_unique();
    env.write_token_account(not_ata, USDC_MINT, owner.pubkey(), 0);
    let res = env.try_update_config_with(&admin, None, None, None, Some(owner.pubkey()), Some(not_ata));
    assert_escrow_err(res, EscrowError::TreasuryNotOwnerAta);
}

#[test]
fn update_config_with_someone_elses_ata_as_treasury_fails() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let owner = env.wallet();
    let other = env.funded(0);
    let res =
        env.try_update_config_with(&admin, None, None, None, Some(owner.pubkey()), Some(usdc_ata(&other.pubkey())));
    assert_escrow_err(res, EscrowError::TreasuryNotOwnerAta);
}

#[test]
fn update_config_with_an_ata_whose_token_owner_was_changed_fails() {
    // The right address, but its SPL Token owner was moved to another key (SetAuthority): not the owner's account.
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let owner = env.wallet();
    let other = Pubkey::new_unique();
    env.write_token_account(usdc_ata(&owner.pubkey()), USDC_MINT, other, 0);
    let res = env.try_update_config(&admin, None, None, None, Some(owner.pubkey()));
    assert_escrow_err(res, EscrowError::TreasuryNotOwnerAta);
}

#[test]
fn update_config_with_a_job_as_treasury_owner_fails() {
    // A job PDA owning the treasury would make the treasury that job's vault.
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let poster = env.funded(500 * USDC);
    let job = env.post(&poster, &JobParams::default());
    let res = env.try_update_config(&admin, None, None, None, Some(job));
    assert_escrow_err(res, EscrowError::TreasuryOwnerIsProgramAccount);
    assert_eq!(env.config().treasury, env.treasury);
}

#[test]
fn update_config_with_the_config_as_treasury_owner_fails() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    env.create_ata(&config_pda(), &USDC_MINT);
    let res = env.try_update_config(&admin, None, None, None, Some(config_pda()));
    assert_escrow_err(res, EscrowError::TreasuryOwnerIsProgramAccount);
}

#[test]
fn update_config_with_only_one_of_treasury_owner_and_treasury_fails() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let owner = env.funded(0);
    let res = env.try_update_config_with(&admin, None, None, None, Some(owner.pubkey()), None);
    assert_escrow_err(res, EscrowError::TreasuryOwnerAndAtaRequired);
    let res = env.try_update_config_with(&admin, None, None, None, None, Some(usdc_ata(&owner.pubkey())));
    assert_escrow_err(res, EscrowError::TreasuryOwnerAndAtaRequired);
    assert_eq!(env.config().treasury, env.treasury);
}

#[test]
fn propose_then_accept_admin_moves_admin() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let next = env.wallet();
    assert_ok(env.try_propose_admin(&admin, next.pubkey()));
    assert_eq!(env.config().pending_admin, Some(next.pubkey()));
    assert_eq!(env.config().admin, admin.pubkey(), "proposing alone changes nothing");
    assert_ok(env.try_accept_admin(&next));
    let config = env.config();
    assert_eq!(config.admin, next.pubkey());
    assert_eq!(config.pending_admin, None);
    // The old admin lost its rights; the new one has them.
    assert_escrow_err(env.try_update_config(&admin, Some(1), None, None, None), EscrowError::NotAdmin);
    assert_ok(env.try_update_config(&next, Some(1), None, None, None));
}

#[test]
fn propose_admin_of_the_default_address_fails() {
    // Nobody holds the key of the all-zero address (it is the System Program's id).
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let next = env.wallet();
    assert_ok(env.try_propose_admin(&admin, next.pubkey()));
    assert_escrow_err(
        env.try_propose_admin(&admin, anchor_lang::prelude::Pubkey::default()),
        EscrowError::InvalidNewAdmin,
    );
    assert_eq!(env.config().pending_admin, Some(next.pubkey()), "the earlier proposal stands");
}

#[test]
fn propose_admin_by_non_admin_fails() {
    let mut env = Env::new();
    let stranger = env.wallet();
    assert_escrow_err(env.try_propose_admin(&stranger, stranger.pubkey()), EscrowError::NotAdmin);
}

#[test]
fn accept_admin_by_someone_not_proposed_fails() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let next = env.wallet();
    let stranger = env.wallet();
    assert_escrow_err(env.try_accept_admin(&stranger), EscrowError::NotPendingAdmin);
    assert_ok(env.try_propose_admin(&admin, next.pubkey()));
    assert_escrow_err(env.try_accept_admin(&stranger), EscrowError::NotPendingAdmin);
    assert_eq!(env.config().admin, admin.pubkey());
}

#[test]
fn a_second_proposal_replaces_the_first() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let first = env.wallet();
    let second = env.wallet();
    assert_ok(env.try_propose_admin(&admin, first.pubkey()));
    assert_ok(env.try_propose_admin(&admin, second.pubkey()));
    assert_escrow_err(env.try_accept_admin(&first), EscrowError::NotPendingAdmin);
    assert_ok(env.try_accept_admin(&second));
    assert_eq!(env.config().admin, second.pubkey());
}
