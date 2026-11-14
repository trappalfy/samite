use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    constants::*,
    error::EscrowError,
    events::JobCancelled,
    settle::{refund_poster, Vault},
    state::{Config, Job, JobStatus},
};

/// The poster withdraws an open, unclaimed job: full reward back, vault and job closed, rent back. Works while paused.
#[event_cpi]
#[derive(Accounts)]
pub struct CancelJob<'info> {
    #[account(mut)]
    pub poster: Signer<'info>,
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

pub fn handle_cancel_job(ctx: Context<CancelJob>) -> Result<()> {
    require!(ctx.accounts.job.status == JobStatus::Open, EscrowError::JobNotOpen);

    let vault = Vault {
        job: &ctx.accounts.job,
        vault: &ctx.accounts.vault,
        mint: &ctx.accounts.usdc_mint,
        token_program: &ctx.accounts.token_program,
    };
    let refunded = refund_poster(&vault, &ctx.accounts.poster_token, ctx.accounts.poster.to_account_info())?;

    emit_cpi!(JobCancelled {
        job: ctx.accounts.job.key(),
        poster: ctx.accounts.poster.key(),
        refunded,
        at: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
