use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token::{self, Mint, Token, TokenAccount},
};

use crate::{constants::*, error::EscrowError, events::ConfigInitialized, program::SamiteEscrow, state::Config};

/// Creates `Config`. Only the program's upgrade authority (the deployer) can call it, so nobody can
/// front-run the owner between deploy and initialisation. The signer becomes the admin.
#[event_cpi]
#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(address = USDC_MINT @ EscrowError::WrongMint)]
    pub usdc_mint: Account<'info, Mint>,
    /// The wallet (or multisig) whose USDC ATA receives fees. An account owned by this program (a job PDA) is refused.
    /// CHECK: only its key and its owning program are read.
    #[account(constraint = *treasury_owner.owner != crate::ID @ EscrowError::TreasuryOwnerIsProgramAccount)]
    pub treasury_owner: UncheckedAccount<'info>,
    /// The fee account: must be the USDC ATA of `treasury_owner` (`check_treasury`).
    pub treasury: Account<'info, TokenAccount>,
    #[account(constraint = samite_program.programdata_address()? == Some(program_data.key()) @ EscrowError::NotUpgradeAuthority)]
    pub samite_program: Program<'info, SamiteEscrow>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ EscrowError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_config(ctx: Context<InitializeConfig>, fee_bps: u16, min_reward: u64) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, EscrowError::FeeTooHigh);
    require!(min_reward > 0, EscrowError::MinRewardZero);
    require!(ctx.accounts.usdc_mint.decimals == USDC_DECIMALS, EscrowError::WrongMint);
    check_treasury(&ctx.accounts.treasury_owner.key(), &ctx.accounts.treasury, &ctx.accounts.usdc_mint.key())?;

    let config = &mut ctx.accounts.config;
    config.set_inner(Config {
        admin: ctx.accounts.authority.key(),
        treasury: ctx.accounts.treasury.key(),
        usdc_mint: ctx.accounts.usdc_mint.key(),
        fee_bps,
        min_reward,
        paused: false,
        bump: ctx.bumps.config,
        pending_admin: None,
        treasury_owner: ctx.accounts.treasury_owner.key(),
    });

    emit_cpi!(ConfigInitialized {
        admin: config.admin,
        treasury: config.treasury,
        usdc_mint: config.usdc_mint,
        fee_bps,
        min_reward,
    });
    Ok(())
}

/// The fee account must be the USDC ATA (classic SPL Token) of its owner, and still owned by it. Then, if it is ever
/// closed, anyone can re-create it at the same address (the ATA program's `CreateIdempotent`) and payouts go on; a
/// non-ATA account, once closed, could never come back. `Account<TokenAccount>` already guarantees a classic SPL Token
/// account. Used by `initialize_config` and `update_config`.
pub fn check_treasury(owner: &Pubkey, treasury: &Account<TokenAccount>, usdc_mint: &Pubkey) -> Result<()> {
    let ata = get_associated_token_address_with_program_id(owner, usdc_mint, &token::ID);
    require_keys_eq!(treasury.key(), ata, EscrowError::TreasuryNotOwnerAta);
    require_keys_eq!(treasury.owner, *owner, EscrowError::TreasuryNotOwnerAta);
    require_keys_eq!(treasury.mint, *usdc_mint, EscrowError::TreasuryNotOwnerAta);
    Ok(())
}
