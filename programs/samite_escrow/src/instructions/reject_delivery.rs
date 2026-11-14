use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    constants::*,
    error::EscrowError,
    events::{DeliveryRejected, JobRefunded},
    settle::{refund_poster, Vault},
    state::{Config, Job, JobStatus, MachineStats},
};

/// The poster rejects a delivery inside the review window, with the hash of a public reason (§5.3).
/// The machine keeps the job and gets at least MIN_RESUBMIT to deliver again; after the last allowed delivery
/// the poster is refunded and the job closes instead. Works while paused.
#[event_cpi]
#[derive(Accounts)]
pub struct RejectDelivery<'info> {
    #[account(mut)]
    pub poster: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [JOB_SEED, job.poster.as_ref(), &job.job_id.to_le_bytes()],
        bump = job.bump,
        has_one = poster @ EscrowError::NotThePoster,
    )]
    pub job: Box<Account<'info, Job>>,
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
    /// Receives the refund if this was the last allowed delivery.
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = poster,
        associated_token::token_program = token_program,
    )]
    pub poster_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_reject_delivery(ctx: Context<RejectDelivery>, reason_hash: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    {
        let job = &ctx.accounts.job;
        require!(job.status == JobStatus::Delivered, EscrowError::JobNotDelivered);
        let review_ends = job.delivered_at.checked_add(job.review_window).ok_or(EscrowError::MathOverflow)?;
        require!(now <= review_ends, EscrowError::ReviewWindowPassed);
        require!(reason_hash != [0u8; 32], EscrowError::ReasonHashMissing);
    }

    let stats = &mut ctx.accounts.machine_stats;
    stats.rejected = stats.rejected.checked_add(1).ok_or(EscrowError::MathOverflow)?;

    let job_key = ctx.accounts.job.key();
    let machine = ctx.accounts.machine.key();
    let attempt = ctx.accounts.job.deliveries;

    if attempt >= MAX_DELIVERIES {
        // Last allowed delivery rejected: refund the poster and close vault + job (rent to the poster).
        let vault = Vault {
            job: &ctx.accounts.job,
            vault: &ctx.accounts.vault,
            mint: &ctx.accounts.usdc_mint,
            token_program: &ctx.accounts.token_program,
        };
        let refunded = refund_poster(&vault, &ctx.accounts.poster_token, ctx.accounts.poster.to_account_info())?;
        let deadline = ctx.accounts.job.deadline;
        ctx.accounts.job.close(ctx.accounts.poster.to_account_info())?;

        emit_cpi!(DeliveryRejected { job: job_key, machine, reason_hash, attempt, deadline, refunded: true, at: now });
        emit_cpi!(JobRefunded {
            job: job_key,
            poster: ctx.accounts.poster.key(),
            refunded,
            deliveries: attempt,
            at: now
        });
        return Ok(());
    }

    // The machine keeps the job. Its claim restarts now, and it always gets at least MIN_RESUBMIT to fix it.
    let earliest_deadline = now.checked_add(MIN_RESUBMIT).ok_or(EscrowError::MathOverflow)?;
    let job = &mut ctx.accounts.job;
    job.status = JobStatus::Claimed;
    job.claimed_at = now;
    if job.deadline < earliest_deadline {
        job.deadline = earliest_deadline;
    }
    let deadline = job.deadline;

    emit_cpi!(DeliveryRejected { job: job_key, machine, reason_hash, attempt, deadline, refunded: false, at: now });
    Ok(())
}
