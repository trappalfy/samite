use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    constants::*,
    error::EscrowError,
    events::JobPaid,
    settle::{pay_machine, Vault},
    state::{Config, Job, JobStatus, MachineStats},
};

/// Permissionless auto-release: once the review window has passed with no answer, the machine is paid exactly as on
/// accept (same `pay_machine`). Rent goes to the poster, never to the caller.
#[event_cpi]
#[derive(Accounts)]
pub struct ReleaseAfterReview<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [JOB_SEED, job.poster.as_ref(), &job.job_id.to_le_bytes()],
        bump = job.bump,
        has_one = poster @ EscrowError::NotThePoster,
        close = poster,
    )]
    pub job: Box<Account<'info, Job>>,
    /// CHECK: the job's poster (`has_one`); receives the vault's and the job's rent.
    #[account(mut)]
    pub poster: UncheckedAccount<'info>,
    /// CHECK: must be the job's machine; only its key is used.
    #[account(constraint = job.worker == Some(machine.key()) @ EscrowError::WrongMachine)]
    pub machine: UncheckedAccount<'info>,
    #[account(mut, seeds = [MACHINE_SEED, machine.key().as_ref()], bump = machine_stats.bump)]
    pub machine_stats: Box<Account<'info, MachineStats>>,
    #[account(address = config.usdc_mint @ EscrowError::WrongMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = job,
        associated_token::token_program = token_program,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = machine,
        associated_token::token_program = token_program,
    )]
    pub machine_token: Box<Account<'info, TokenAccount>>,
    /// `dup`: the treasury may be the machine's own ATA; the payout must not fail on that.
    #[account(mut, dup, address = config.treasury @ EscrowError::WrongTreasury)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_release_after_review(ctx: Context<ReleaseAfterReview>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let job = &ctx.accounts.job;
    require!(job.status == JobStatus::Delivered, EscrowError::JobNotDelivered);
    let review_ends = job.delivered_at.checked_add(job.review_window).ok_or(EscrowError::MathOverflow)?;
    require!(now > review_ends, EscrowError::ReviewWindowNotPassed);

    let vault = Vault {
        job: &ctx.accounts.job,
        vault: &ctx.accounts.vault,
        mint: &ctx.accounts.usdc_mint,
        token_program: &ctx.accounts.token_program,
    };
    let paid = pay_machine(
        &vault,
        &ctx.accounts.machine_token,
        &ctx.accounts.treasury,
        &mut ctx.accounts.machine_stats,
        ctx.accounts.poster.to_account_info(),
    )?;

    emit_cpi!(JobPaid {
        job: ctx.accounts.job.key(),
        poster: ctx.accounts.poster.key(),
        machine: ctx.accounts.machine.key(),
        reward: ctx.accounts.job.reward,
        to_machine: paid.to_machine,
        fee: paid.fee,
        auto: true,
        at: now,
    });
    Ok(())
}
