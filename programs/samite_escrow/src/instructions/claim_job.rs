use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    constants::*,
    error::EscrowError,
    events::JobClaimed,
    state::{ClaimPolicy, Config, Job, JobStatus, MachineStats},
};

/// A machine takes an open job. Its USDC ATA must already exist (so a payout can never fail on a missing account),
/// and its `MachineStats` is created on the first claim, paid by the machine. The machine that last left the job
/// (`Job.previous_worker`) can't claim it again. Blocked while paused.
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimJob<'info> {
    #[account(mut)]
    pub machine: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = !config.paused @ EscrowError::Paused)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [JOB_SEED, job.poster.as_ref(), &job.job_id.to_le_bytes()], bump = job.bump)]
    pub job: Box<Account<'info, Job>>,
    #[account(address = config.usdc_mint @ EscrowError::WrongMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(
        associated_token::mint = usdc_mint,
        associated_token::authority = machine,
        associated_token::token_program = token_program,
    )]
    pub machine_token: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = machine,
        space = 8 + MachineStats::INIT_SPACE,
        seeds = [MACHINE_SEED, machine.key().as_ref()],
        bump,
    )]
    pub machine_stats: Box<Account<'info, MachineStats>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim_job(ctx: Context<ClaimJob>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let machine = ctx.accounts.machine.key();

    // The PDA seeds bind the stats to this machine; on the first claim these two fields are set, later they are
    // rewritten with the same values.
    let stats = &mut ctx.accounts.machine_stats;
    stats.machine = machine;
    stats.bump = ctx.bumps.machine_stats;
    let accepted = stats.accepted;

    let job = &mut ctx.accounts.job;
    require!(job.status == JobStatus::Open, EscrowError::JobNotOpen);
    require!(now < job.deadline, EscrowError::DeadlinePassed);
    require_keys_neq!(machine, job.poster, EscrowError::PosterCannotClaim);
    // A machine that left this job can't take it back: otherwise `[unclaim_job, claim_job]` or
    // `[expire_claim, claim_job]` in one transaction would renew its claim window forever.
    require!(job.previous_worker != Some(machine), EscrowError::CannotReclaim);
    match job.policy {
        ClaimPolicy::Any => {}
        ClaimPolicy::Proven { min_accepted } => require!(accepted >= min_accepted, EscrowError::NotProven),
        ClaimPolicy::Allowlist => require!(job.allowlist.contains(&machine), EscrowError::NotOnAllowlist),
    }

    job.worker = Some(machine);
    job.claimed_at = now;
    job.status = JobStatus::Claimed;
    let job_key = job.key();

    emit_cpi!(JobClaimed { job: job_key, machine, claimed_at: now });
    Ok(())
}
