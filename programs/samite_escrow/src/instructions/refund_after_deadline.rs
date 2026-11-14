use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    constants::*,
    error::EscrowError,
    events::JobRefunded,
    settle::{refund_poster, Vault},
    state::{Config, Job, JobStatus},
};

/// Permissionless. After the deadline, an `Open` or `Claimed` job refunds the poster in full and closes.
/// Never while `Delivered`: a delivery waiting for review protects the machine.
#[event_cpi]
#[derive(Accounts)]
pub struct RefundAfterDeadline<'info> {
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
        associated_token::authority = poster,
        associated_token::token_program = token_program,
    )]
    pub poster_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_refund_after_deadline(ctx: Context<RefundAfterDeadline>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let job = &ctx.accounts.job;
    require!(job.status != JobStatus::Delivered, EscrowError::RefundWhileDelivered);
    require!(now > job.deadline, EscrowError::DeadlineNotPassed);
    let deliveries = job.deliveries;

    let vault = Vault {
        job: &ctx.accounts.job,
        vault: &ctx.accounts.vault,
        mint: &ctx.accounts.usdc_mint,
        token_program: &ctx.accounts.token_program,
    };
    let refunded = refund_poster(&vault, &ctx.accounts.poster_token, ctx.accounts.poster.to_account_info())?;

    emit_cpi!(JobRefunded {
        job: ctx.accounts.job.key(),
        poster: ctx.accounts.poster.key(),
        refunded,
        deliveries,
        at: now,
    });
    Ok(())
}
