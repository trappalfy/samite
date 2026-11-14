//! Test harness: LiteSVM with the built program, a local USDC mint at the real USDC address (CLAUDE.md §3.2),
//! a clock we control, and builders for every instruction.
//!
//! Every transaction is paid by `env.payer`, a separate fee payer, so the poster's, machine's and treasury's
//! balances move only by what the program moves. That is what makes the exact-balance assertions exact.
#![allow(dead_code, clippy::result_large_err)]

use anchor_lang::{
    prelude::{Clock, Pubkey},
    solana_program::{bpf_loader_upgradeable, instruction::Instruction},
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use litesvm::{types::TransactionResult, LiteSVM};
use samite_escrow::{
    accounts, instruction,
    state::{ClaimPolicy, Config, Job, MachineStats},
    CONFIG_SEED, JOB_SEED, MACHINE_SEED, USDC_MINT,
};
use solana_account::Account;
use solana_instruction_error::InstructionError;
use solana_keypair::Keypair;
use solana_program_option::COption;
use solana_program_pack::Pack;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;
use spl_token_interface::state::{Account as SplTokenAccount, AccountState, Mint as SplMint};

pub const USDC: u64 = 1_000_000;
pub const HOUR: i64 = 3_600;
pub const DAY: i64 = 24 * HOUR;
/// Unix time the tests start at (2027-01-15).
pub const START: i64 = 1_800_000_000;
pub const SOL: u64 = 1_000_000_000;

pub const TOKEN_PROGRAM: Pubkey = spl_token_interface::ID;
pub const TOKEN_2022_PROGRAM: Pubkey = anchor_lang::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const ATA_PROGRAM: Pubkey = spl_associated_token_account_interface::program::ID;
pub const SYSTEM_PROGRAM: Pubkey = anchor_lang::system_program::ID;

pub struct Env {
    pub svm: LiteSVM,
    /// Pays every transaction fee (never an actor in the escrow).
    pub payer: Keypair,
    /// Upgrade authority of the program and admin of the config.
    pub admin: Keypair,
    pub mint_authority: Keypair,
    pub treasury_owner: Keypair,
    /// USDC ATA of `treasury_owner`, the fee account.
    pub treasury: Pubkey,
}

// ---------------------------------------------------------------- addresses

pub fn program_id() -> Pubkey {
    samite_escrow::ID
}

pub fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_SEED], &program_id()).0
}

pub fn job_pda(poster: &Pubkey, job_id: u64) -> Pubkey {
    Pubkey::find_program_address(&[JOB_SEED, poster.as_ref(), &job_id.to_le_bytes()], &program_id()).0
}

pub fn stats_pda(machine: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[MACHINE_SEED, machine.as_ref()], &program_id()).0
}

pub fn event_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &program_id()).0
}

pub fn program_data() -> Pubkey {
    Pubkey::find_program_address(&[program_id().as_ref()], &bpf_loader_upgradeable::ID).0
}

pub fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    spl_associated_token_account_interface::address::get_associated_token_address(owner, mint)
}

pub fn usdc_ata(owner: &Pubkey) -> Pubkey {
    ata(owner, &USDC_MINT)
}

pub fn ix(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    Instruction::new_with_bytes(program_id(), &data.data(), accounts.to_account_metas(None))
}

// ---------------------------------------------------------------- errors

/// Asserts that the transaction failed with this custom program error code.
pub fn assert_code(res: TransactionResult, code: u32) {
    match res {
        Ok(meta) => panic!("expected error {code}, but the transaction succeeded. Logs:\n{}", meta.logs.join("\n")),
        Err(failed) => match &failed.err {
            TransactionError::InstructionError(_, InstructionError::Custom(got)) => {
                assert_eq!(*got, code, "wrong error code. Logs:\n{}", failed.meta.logs.join("\n"))
            }
            other => panic!("expected custom error {code}, got {other:?}. Logs:\n{}", failed.meta.logs.join("\n")),
        },
    }
}

pub fn assert_escrow_err(res: TransactionResult, err: samite_escrow::error::EscrowError) {
    assert_code(res, u32::from(err));
}

pub fn assert_anchor_err(res: TransactionResult, err: anchor_lang::error::ErrorCode) {
    assert_code(res, err as u32);
}

/// As `assert_anchor_err`, and the error must be raised on the account named `account`
/// (Anchor logs "AnchorError caused by account: <name>").
pub fn assert_anchor_err_on(res: TransactionResult, err: anchor_lang::error::ErrorCode, account: &str) {
    let logs = match &res {
        Err(failed) => failed.meta.logs.join("\n"),
        Ok(_) => String::new(),
    };
    assert_code(res, err as u32);
    let needle = format!("AnchorError caused by account: {account}.");
    assert!(logs.contains(&needle), "expected the error on account `{account}`. Logs:\n{logs}");
}

/// The transaction failed with a custom error code raised by another program (the System or SPL Token program, in
/// a CPI), and the logs contain `log` (codes from different programs overlap, so the log names the cause).
pub fn assert_cpi_err(res: TransactionResult, code: u32, log: &str) {
    let logs = match &res {
        Err(failed) => failed.meta.logs.join("\n"),
        Ok(_) => String::new(),
    };
    assert_code(res, code);
    assert!(logs.contains(log), "expected `{log}` in the logs:\n{logs}");
}

/// The transaction failed with this (non-custom) instruction error.
pub fn assert_ix_err(res: TransactionResult, expected: InstructionError) {
    match res {
        Ok(meta) => panic!("expected {expected:?}, but the transaction succeeded. Logs:\n{}", meta.logs.join("\n")),
        Err(failed) => match &failed.err {
            TransactionError::InstructionError(_, got) => {
                assert_eq!(*got, expected, "wrong error. Logs:\n{}", failed.meta.logs.join("\n"))
            }
            other => panic!("expected {expected:?}, got {other:?}. Logs:\n{}", failed.meta.logs.join("\n")),
        },
    }
}

pub fn assert_ok(res: TransactionResult) -> litesvm::types::TransactionMetadata {
    match res {
        Ok(meta) => meta,
        Err(failed) => panic!("transaction failed: {:?}. Logs:\n{}", failed.err, failed.meta.logs.join("\n")),
    }
}

// ---------------------------------------------------------------- events

/// Decodes every `emit_cpi!` event of type `E` from the transaction's inner instructions.
/// An event CPI's data is `EVENT_IX_TAG_LE ++ E::DISCRIMINATOR ++ borsh(E)`.
pub fn events<E>(meta: &litesvm::types::TransactionMetadata) -> Vec<E>
where
    E: anchor_lang::Event + anchor_lang::AnchorDeserialize,
{
    let tag = anchor_lang::event::EVENT_IX_TAG_LE;
    meta.inner_instructions
        .iter()
        .flatten()
        .filter_map(|inner| {
            let data = &inner.instruction.data;
            let rest = data.strip_prefix(tag)?;
            let body = rest.strip_prefix(E::DISCRIMINATOR)?;
            Some(E::try_from_slice(body).expect("event decodes"))
        })
        .collect()
}

/// Number of event CPIs (of any type) in the transaction.
pub fn event_count(meta: &litesvm::types::TransactionMetadata) -> usize {
    let tag = anchor_lang::event::EVENT_IX_TAG_LE;
    meta.inner_instructions.iter().flatten().filter(|i| i.instruction.data.starts_with(tag)).count()
}

// ---------------------------------------------------------------- job parameters

#[derive(Clone)]
pub struct JobParams {
    pub job_id: u64,
    pub reward: u64,
    /// Seconds from now.
    pub deadline_in: i64,
    pub review_window: i64,
    /// 0 here means the full term (`deadline_in`): the program itself refuses 0.
    pub claim_window: i64,
    pub policy: ClaimPolicy,
    pub allowlist: Vec<Pubkey>,
    pub spec_hash: [u8; 32],
}

impl Default for JobParams {
    fn default() -> Self {
        Self {
            job_id: 415,
            reward: 120 * USDC,
            deadline_in: 3 * DAY,
            review_window: 48 * HOUR,
            claim_window: 0,
            policy: ClaimPolicy::Any,
            allowlist: vec![],
            spec_hash: [7; 32],
        }
    }
}

// ---------------------------------------------------------------- environment

impl Env {
    /// Program loaded, admin set as upgrade authority, local USDC, config initialised at 250 bps / 1 USDC.
    pub fn new() -> Self {
        let mut env = Self::bare();
        assert_ok(env.try_initialize_config(&env.admin.insecure_clone(), 250, USDC));
        env
    }

    /// Program loaded and USDC in place, but no config yet.
    pub fn bare() -> Self {
        let mut svm = LiteSVM::new();
        let so_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/samite_escrow.so");
        let bytes = std::fs::read(so_path)
            .unwrap_or_else(|e| panic!("{so_path}: {e}. Run `anchor build` before `cargo test`."));
        svm.add_program(program_id(), &bytes).unwrap();

        let payer = Keypair::new();
        let admin = Keypair::new();
        let mint_authority = Keypair::new();
        let treasury_owner = Keypair::new();
        svm.airdrop(&payer.pubkey(), 1_000 * SOL).unwrap();
        svm.airdrop(&admin.pubkey(), 10 * SOL).unwrap();

        let mut env = Self { svm, payer, admin, mint_authority, treasury_owner, treasury: Pubkey::default() };
        env.set_time(START);
        env.set_upgrade_authority(Some(env.admin.pubkey()));
        env.write_mint(USDC_MINT, 6);
        let owner = env.treasury_owner.pubkey();
        env.treasury = env.create_ata(&owner, &USDC_MINT);
        env
    }

    /// LiteSVM loads the program with no upgrade authority; write one into the ProgramData header.
    /// Layout (bincode): u32 variant (3 = ProgramData), u64 slot, u8 option tag, 32-byte authority.
    pub fn set_upgrade_authority(&mut self, authority: Option<Pubkey>) {
        let address = program_data();
        let mut account = self.svm.get_account(&address).expect("programdata");
        assert_eq!(&account.data[0..4], &[3, 0, 0, 0], "not a ProgramData account");
        match authority {
            Some(key) => {
                account.data[12] = 1;
                account.data[13..45].copy_from_slice(key.as_ref());
            }
            None => {
                account.data[12] = 0;
                account.data[13..45].fill(0);
            }
        }
        self.svm.set_account(address, account).unwrap();
    }

    /// A classic SPL Token mint at `address` with our test mint authority (§3.2).
    pub fn write_mint(&mut self, address: Pubkey, decimals: u8) {
        let mut data = vec![0u8; SplMint::LEN];
        SplMint {
            mint_authority: COption::Some(self.mint_authority.pubkey()),
            supply: 0,
            decimals,
            is_initialized: true,
            freeze_authority: COption::None,
        }
        .pack_into_slice(&mut data);
        let lamports = self.svm.minimum_balance_for_rent_exemption(SplMint::LEN);
        self.svm
            .set_account(address, Account { lamports, data, owner: TOKEN_PROGRAM, executable: false, rent_epoch: 0 })
            .unwrap();
    }

    /// A token account owned by `owner` at an arbitrary (non-ATA) address.
    pub fn write_token_account(&mut self, address: Pubkey, mint: Pubkey, owner: Pubkey, amount: u64) {
        self.write_token_account_with(address, mint, owner, amount, None, None);
    }

    /// A token account written directly, with an optional delegate (of the whole amount) and close authority.
    pub fn write_token_account_with(
        &mut self,
        address: Pubkey,
        mint: Pubkey,
        owner: Pubkey,
        amount: u64,
        delegate: Option<Pubkey>,
        close_authority: Option<Pubkey>,
    ) {
        let mut data = vec![0u8; SplTokenAccount::LEN];
        SplTokenAccount {
            mint,
            owner,
            amount,
            delegate: delegate.map_or(COption::None, COption::Some),
            state: AccountState::Initialized,
            is_native: COption::None,
            delegated_amount: if delegate.is_some() { amount } else { 0 },
            close_authority: close_authority.map_or(COption::None, COption::Some),
        }
        .pack_into_slice(&mut data);
        let lamports = self.svm.minimum_balance_for_rent_exemption(SplTokenAccount::LEN);
        self.svm
            .set_account(address, Account { lamports, data, owner: TOKEN_PROGRAM, executable: false, rent_epoch: 0 })
            .unwrap();
    }

    /// Sends one transaction, fee paid by `self.payer`, then moves to a fresh blockhash so an identical
    /// transaction later in the test is not deduplicated.
    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> TransactionResult {
        let mut all: Vec<&Keypair> = vec![&self.payer];
        all.extend_from_slice(signers);
        let tx = Transaction::new_signed_with_payer(ixs, Some(&self.payer.pubkey()), &all, self.svm.latest_blockhash());
        let res = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        res
    }

    // ------------------------------------------------------------ clock

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = unix_timestamp;
        self.svm.set_sysvar(&clock);
    }

    pub fn advance(&mut self, seconds: i64) {
        let now = self.now();
        self.set_time(now + seconds);
    }

    // ------------------------------------------------------------ wallets and tokens

    pub fn wallet(&mut self) -> Keypair {
        let kp = Keypair::new();
        self.svm.airdrop(&kp.pubkey(), 10 * SOL).unwrap();
        kp
    }

    /// A wallet with a USDC ATA holding `usdc` base units.
    pub fn funded(&mut self, usdc: u64) -> Keypair {
        let kp = self.wallet();
        let ata = self.create_ata(&kp.pubkey(), &USDC_MINT);
        if usdc > 0 {
            self.mint(&USDC_MINT, &ata, usdc);
        }
        kp
    }

    pub fn create_ata(&mut self, owner: &Pubkey, mint: &Pubkey) -> Pubkey {
        let ix = spl_associated_token_account_interface::instruction::create_associated_token_account(
            &self.payer.pubkey(),
            owner,
            mint,
            &TOKEN_PROGRAM,
        );
        assert_ok(self.send(&[ix], &[]));
        ata(owner, mint)
    }

    /// The ATA program's `CreateIdempotent`, paid by the fee payer: anyone can (re-)create anyone's ATA.
    pub fn create_ata_idempotent_ix(&self, owner: &Pubkey, mint: &Pubkey) -> Instruction {
        spl_associated_token_account_interface::instruction::create_associated_token_account_idempotent(
            &self.payer.pubkey(),
            owner,
            mint,
            &TOKEN_PROGRAM,
        )
    }

    pub fn mint(&mut self, mint: &Pubkey, to: &Pubkey, amount: u64) {
        let authority = self.mint_authority.insecure_clone();
        let ix = spl_token_interface::instruction::mint_to(&TOKEN_PROGRAM, mint, to, &authority.pubkey(), &[], amount)
            .unwrap();
        assert_ok(self.send(&[ix], &[&authority]));
    }

    pub fn token_balance(&self, token_account: &Pubkey) -> u64 {
        let account = self.svm.get_account(token_account).expect("token account exists");
        SplTokenAccount::unpack(&account.data).unwrap().amount
    }

    pub fn usdc(&self, owner: &Pubkey) -> u64 {
        self.token_balance(&usdc_ata(owner))
    }

    pub fn lamports(&self, address: &Pubkey) -> u64 {
        self.svm.get_account(address).map(|a| a.lamports).unwrap_or(0)
    }

    pub fn exists(&self, address: &Pubkey) -> bool {
        self.svm.get_account(address).is_some_and(|a| a.lamports > 0)
    }

    pub fn rent(&self, len: usize) -> u64 {
        self.svm.minimum_balance_for_rent_exemption(len)
    }

    // ------------------------------------------------------------ program state

    fn decode<T: AccountDeserialize>(&self, address: &Pubkey) -> T {
        let account = self.svm.get_account(address).unwrap_or_else(|| panic!("account {address} missing"));
        T::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    pub fn config(&self) -> Config {
        self.decode(&config_pda())
    }

    pub fn job(&self, job: &Pubkey) -> Job {
        self.decode(job)
    }

    pub fn stats(&self, machine: &Pubkey) -> MachineStats {
        self.decode(&stats_pda(machine))
    }

    // ------------------------------------------------------------ config instructions

    pub fn initialize_config_accounts(&self, authority: &Pubkey) -> accounts::InitializeConfig {
        accounts::InitializeConfig {
            authority: *authority,
            config: config_pda(),
            usdc_mint: USDC_MINT,
            treasury_owner: self.treasury_owner.pubkey(),
            treasury: self.treasury,
            samite_program: program_id(),
            program_data: program_data(),
            token_program: TOKEN_PROGRAM,
            system_program: SYSTEM_PROGRAM,
            event_authority: event_authority(),
            program: program_id(),
        }
    }

    pub fn try_initialize_config(&mut self, authority: &Keypair, fee_bps: u16, min_reward: u64) -> TransactionResult {
        let accs = self.initialize_config_accounts(&authority.pubkey());
        self.send(&[ix(accs, instruction::InitializeConfig { fee_bps, min_reward })], &[authority])
    }

    pub fn update_config_accounts(
        &self,
        admin: &Pubkey,
        new_treasury_owner: Option<Pubkey>,
        new_treasury: Option<Pubkey>,
    ) -> accounts::UpdateConfig {
        accounts::UpdateConfig {
            admin: *admin,
            config: config_pda(),
            new_treasury_owner,
            new_treasury,
            event_authority: event_authority(),
            program: program_id(),
        }
    }

    /// `new_treasury_owner`: the fee account becomes that owner's USDC ATA (passed alongside it).
    pub fn try_update_config(
        &mut self,
        admin: &Keypair,
        fee_bps: Option<u16>,
        min_reward: Option<u64>,
        paused: Option<bool>,
        new_treasury_owner: Option<Pubkey>,
    ) -> TransactionResult {
        let new_treasury = new_treasury_owner.map(|owner| usdc_ata(&owner));
        self.try_update_config_with(admin, fee_bps, min_reward, paused, new_treasury_owner, new_treasury)
    }

    /// As `try_update_config`, with the treasury owner and the treasury token account chosen separately.
    pub fn try_update_config_with(
        &mut self,
        admin: &Keypair,
        fee_bps: Option<u16>,
        min_reward: Option<u64>,
        paused: Option<bool>,
        new_treasury_owner: Option<Pubkey>,
        new_treasury: Option<Pubkey>,
    ) -> TransactionResult {
        let accs = self.update_config_accounts(&admin.pubkey(), new_treasury_owner, new_treasury);
        self.send(&[ix(accs, instruction::UpdateConfig { fee_bps, min_reward, paused })], &[admin])
    }

    pub fn set_fee(&mut self, fee_bps: u16) {
        let admin = self.admin.insecure_clone();
        assert_ok(self.try_update_config(&admin, Some(fee_bps), None, None, None));
    }

    pub fn set_paused(&mut self, paused: bool) {
        let admin = self.admin.insecure_clone();
        assert_ok(self.try_update_config(&admin, None, None, Some(paused), None));
    }

    pub fn try_propose_admin(&mut self, admin: &Keypair, new_admin: Pubkey) -> TransactionResult {
        let accs = accounts::ProposeAdmin {
            admin: admin.pubkey(),
            config: config_pda(),
            event_authority: event_authority(),
            program: program_id(),
        };
        self.send(&[ix(accs, instruction::ProposeAdmin { new_admin })], &[admin])
    }

    pub fn try_accept_admin(&mut self, new_admin: &Keypair) -> TransactionResult {
        let accs = accounts::AcceptAdmin {
            new_admin: new_admin.pubkey(),
            config: config_pda(),
            event_authority: event_authority(),
            program: program_id(),
        };
        self.send(&[ix(accs, instruction::AcceptAdmin {})], &[new_admin])
    }

    // ------------------------------------------------------------ rent

    pub fn job_rent(&self) -> u64 {
        self.rent(8 + <Job as anchor_lang::Space>::INIT_SPACE)
    }

    pub fn vault_rent(&self) -> u64 {
        self.rent(SplTokenAccount::LEN)
    }

    pub fn stats_rent(&self) -> u64 {
        self.rent(8 + <MachineStats as anchor_lang::Space>::INIT_SPACE)
    }

    // ------------------------------------------------------------ post / cancel / refund

    pub fn post_accounts(&self, poster: &Pubkey, job_id: u64) -> accounts::PostJob {
        let job = job_pda(poster, job_id);
        accounts::PostJob {
            poster: *poster,
            config: config_pda(),
            usdc_mint: USDC_MINT,
            poster_token: usdc_ata(poster),
            job,
            vault: usdc_ata(&job),
            token_program: TOKEN_PROGRAM,
            associated_token_program: ATA_PROGRAM,
            system_program: SYSTEM_PROGRAM,
            event_authority: event_authority(),
            program: program_id(),
        }
    }

    pub fn post_data(&self, p: &JobParams) -> instruction::PostJob {
        instruction::PostJob {
            job_id: p.job_id,
            reward: p.reward,
            deadline: self.now() + p.deadline_in,
            review_window: p.review_window,
            claim_window: if p.claim_window == 0 { p.deadline_in } else { p.claim_window },
            policy: p.policy,
            allowlist: p.allowlist.clone(),
            spec_hash: p.spec_hash,
        }
    }

    pub fn try_post(&mut self, poster: &Keypair, p: &JobParams) -> TransactionResult {
        let accs = self.post_accounts(&poster.pubkey(), p.job_id);
        let data = self.post_data(p);
        self.send(&[ix(accs, data)], &[poster])
    }

    /// Posts and returns the job PDA.
    pub fn post(&mut self, poster: &Keypair, p: &JobParams) -> Pubkey {
        assert_ok(self.try_post(poster, p));
        job_pda(&poster.pubkey(), p.job_id)
    }

    pub fn cancel_accounts(&self, poster: &Pubkey, job: &Pubkey) -> accounts::CancelJob {
        accounts::CancelJob {
            poster: *poster,
            config: config_pda(),
            job: *job,
            usdc_mint: USDC_MINT,
            vault: usdc_ata(job),
            poster_token: usdc_ata(poster),
            token_program: TOKEN_PROGRAM,
            event_authority: event_authority(),
            program: program_id(),
        }
    }

    pub fn try_cancel(&mut self, poster: &Keypair, job: &Pubkey) -> TransactionResult {
        let accs = self.cancel_accounts(&poster.pubkey(), job);
        self.send(&[ix(accs, instruction::CancelJob {})], &[poster])
    }

    pub fn refund_accounts(&self, poster: &Pubkey, job: &Pubkey) -> accounts::RefundAfterDeadline {
        accounts::RefundAfterDeadline {
            config: config_pda(),
            job: *job,
            poster: *poster,
            usdc_mint: USDC_MINT,
            vault: usdc_ata(job),
            poster_token: usdc_ata(poster),
            token_program: TOKEN_PROGRAM,
            event_authority: event_authority(),
            program: program_id(),
        }
    }

    /// Permissionless: no signer but the fee payer.
    pub fn try_refund(&mut self, poster: &Pubkey, job: &Pubkey) -> TransactionResult {
        let accs = self.refund_accounts(poster, job);
        self.send(&[ix(accs, instruction::RefundAfterDeadline {})], &[])
    }

    // ------------------------------------------------------------ claim / unclaim / expire

    pub fn claim_accounts(&self, machine: &Pubkey, job: &Pubkey) -> accounts::ClaimJob {
        accounts::ClaimJob {
            machine: *machine,
            config: config_pda(),
            job: *job,
            usdc_mint: USDC_MINT,
            machine_token: usdc_ata(machine),
            machine_stats: stats_pda(machine),
            token_program: TOKEN_PROGRAM,
            system_program: SYSTEM_PROGRAM,
            event_authority: event_authority(),
            program: program_id(),
        }
    }

    pub fn claim_ix(&self, machine: &Pubkey, job: &Pubkey) -> Instruction {
        ix(self.claim_accounts(machine, job), instruction::ClaimJob {})
    }

    pub fn try_claim(&mut self, machine: &Keypair, job: &Pubkey) -> TransactionResult {
        let claim = self.claim_ix(&machine.pubkey(), job);
        self.send(&[claim], &[machine])
    }

    pub fn claim(&mut self, machine: &Keypair, job: &Pubkey) {
        assert_ok(self.try_claim(machine, job));
    }

    pub fn unclaim_ix(&self, machine: &Pubkey, job: &Pubkey) -> Instruction {
        let accs = accounts::UnclaimJob {
            machine: *machine,
            job: *job,
            event_authority: event_authority(),
            program: program_id(),
        };
        ix(accs, instruction::UnclaimJob {})
    }

    pub fn try_unclaim(&mut self, machine: &Keypair, job: &Pubkey) -> TransactionResult {
        let unclaim = self.unclaim_ix(&machine.pubkey(), job);
        self.send(&[unclaim], &[machine])
    }

    pub fn expire_ix(&self, job: &Pubkey) -> Instruction {
        let accs = accounts::ExpireClaim { job: *job, event_authority: event_authority(), program: program_id() };
        ix(accs, instruction::ExpireClaim {})
    }

    /// Permissionless: no signer but the fee payer.
    pub fn try_expire(&mut self, job: &Pubkey) -> TransactionResult {
        let expire = self.expire_ix(job);
        self.send(&[expire], &[])
    }

    // ------------------------------------------------------------ deliver / accept / reject / release

    pub fn try_deliver(&mut self, machine: &Keypair, job: &Pubkey, delivery_hash: [u8; 32]) -> TransactionResult {
        let accs = accounts::SubmitDelivery {
            machine: machine.pubkey(),
            job: *job,
            event_authority: event_authority(),
            program: program_id(),
        };
        self.send(&[ix(accs, instruction::SubmitDelivery { delivery_hash })], &[machine])
    }

    pub fn deliver(&mut self, machine: &Keypair, job: &Pubkey, delivery_hash: [u8; 32]) {
        assert_ok(self.try_deliver(machine, job, delivery_hash));
    }

    pub fn accept_accounts(&self, poster: &Pubkey, machine: &Pubkey, job: &Pubkey) -> accounts::AcceptDelivery {
        accounts::AcceptDelivery {
            poster: *poster,
            config: config_pda(),
            job: *job,
            machine: *machine,
            machine_stats: stats_pda(machine),
            usdc_mint: USDC_MINT,
            vault: usdc_ata(job),
            machine_token: usdc_ata(machine),
            treasury: self.config().treasury,
            token_program: TOKEN_PROGRAM,
            event_authority: event_authority(),
            program: program_id(),
        }
    }

    pub fn try_accept(&mut self, poster: &Keypair, machine: &Pubkey, job: &Pubkey) -> TransactionResult {
        let accs = self.accept_accounts(&poster.pubkey(), machine, job);
        self.send(&[ix(accs, instruction::AcceptDelivery {})], &[poster])
    }

    pub fn release_accounts(&self, poster: &Pubkey, machine: &Pubkey, job: &Pubkey) -> accounts::ReleaseAfterReview {
        accounts::ReleaseAfterReview {
            config: config_pda(),
            job: *job,
            poster: *poster,
            machine: *machine,
            machine_stats: stats_pda(machine),
            usdc_mint: USDC_MINT,
            vault: usdc_ata(job),
            machine_token: usdc_ata(machine),
            treasury: self.config().treasury,
            token_program: TOKEN_PROGRAM,
            event_authority: event_authority(),
            program: program_id(),
        }
    }

    /// Permissionless: no signer but the fee payer.
    pub fn try_release(&mut self, poster: &Pubkey, machine: &Pubkey, job: &Pubkey) -> TransactionResult {
        let accs = self.release_accounts(poster, machine, job);
        self.send(&[ix(accs, instruction::ReleaseAfterReview {})], &[])
    }

    pub fn reject_accounts(&self, poster: &Pubkey, machine: &Pubkey, job: &Pubkey) -> accounts::RejectDelivery {
        accounts::RejectDelivery {
            poster: *poster,
            config: config_pda(),
            job: *job,
            machine: *machine,
            machine_stats: stats_pda(machine),
            usdc_mint: USDC_MINT,
            vault: usdc_ata(job),
            poster_token: usdc_ata(poster),
            token_program: TOKEN_PROGRAM,
            event_authority: event_authority(),
            program: program_id(),
        }
    }

    pub fn try_reject(
        &mut self,
        poster: &Keypair,
        machine: &Pubkey,
        job: &Pubkey,
        reason_hash: [u8; 32],
    ) -> TransactionResult {
        let accs = self.reject_accounts(&poster.pubkey(), machine, job);
        self.send(&[ix(accs, instruction::RejectDelivery { reason_hash })], &[poster])
    }

    pub fn reject(&mut self, poster: &Keypair, machine: &Pubkey, job: &Pubkey, reason_hash: [u8; 32]) {
        assert_ok(self.try_reject(poster, machine, job, reason_hash));
    }

    /// Overwrites a job account's state (to reach states the instructions themselves never produce).
    pub fn write_job(&mut self, address: &Pubkey, job: &Job) {
        use anchor_lang::AccountSerialize;
        let mut account = self.svm.get_account(address).expect("job exists");
        let mut data = Vec::new();
        job.try_serialize(&mut data).unwrap();
        data.resize(account.data.len(), 0);
        account.data = data;
        self.svm.set_account(*address, account).unwrap();
    }

    /// Writes a MachineStats account directly (to set up `Proven` policies without running whole jobs).
    pub fn write_stats(&mut self, machine: &Pubkey, accepted: u32) {
        use anchor_lang::AccountSerialize;
        let (address, bump) = Pubkey::find_program_address(&[MACHINE_SEED, machine.as_ref()], &program_id());
        let mut data = Vec::new();
        MachineStats { machine: *machine, accepted, rejected: 0, earned: 0, bump }.try_serialize(&mut data).unwrap();
        data.resize(8 + <MachineStats as anchor_lang::Space>::INIT_SPACE, 0);
        let lamports = self.rent(data.len());
        self.svm
            .set_account(address, Account { lamports, data, owner: program_id(), executable: false, rent_epoch: 0 })
            .unwrap();
    }

    /// Sends USDC straight to an account (e.g. a job's vault) from a fresh wallet.
    pub fn donate(&mut self, to: &Pubkey, amount: u64) {
        let donor = self.funded(amount);
        let ix = spl_token_interface::instruction::transfer(
            &TOKEN_PROGRAM,
            &usdc_ata(&donor.pubkey()),
            to,
            &donor.pubkey(),
            &[],
            amount,
        )
        .unwrap();
        assert_ok(self.send(&[ix], &[&donor]));
    }
}
