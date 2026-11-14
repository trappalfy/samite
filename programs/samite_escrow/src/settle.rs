//! Every way money leaves a job's vault goes through this module (CLAUDE.md §4.5):
//! `pay_machine` (accept and auto-release share it) and `refund_poster` (cancel, refund, last rejection).
//! Both empty the vault and close it with its rent going to the poster; the caller closes the `Job` account.
use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

use crate::{
    constants::{BPS_DENOMINATOR, JOB_SEED},
    error::EscrowError,
    state::{Job, MachineStats},
};

/// `fee = floor(reward * fee_bps / 10_000)` computed in u128, `to_machine = reward - fee`.
pub fn split_reward(reward: u64, fee_bps: u16) -> Result<(u64, u64)> {
    let fee = u128::from(reward)
        .checked_mul(u128::from(fee_bps))
        .and_then(|product| product.checked_div(u128::from(BPS_DENOMINATOR)))
        .ok_or(EscrowError::MathOverflow)?;
    let fee = u64::try_from(fee).map_err(|_| EscrowError::MathOverflow)?;
    let to_machine = reward.checked_sub(fee).ok_or(EscrowError::MathOverflow)?;
    Ok((to_machine, fee))
}

/// A job's vault (the ATA of the job PDA) and what it takes to move tokens out of it.
pub struct Vault<'a, 'info> {
    pub job: &'a Account<'info, Job>,
    pub vault: &'a Account<'info, TokenAccount>,
    pub mint: &'a Account<'info, Mint>,
    pub token_program: &'a Program<'info, Token>,
}

impl<'info> Vault<'_, 'info> {
    /// `transfer_checked` out of the vault, signed by the job PDA.
    fn transfer(&self, to: AccountInfo<'info>, amount: u64) -> Result<()> {
        let job = self.job;
        let id = job.job_id.to_le_bytes();
        let bump = [job.bump];
        let seeds: [&[u8]; 4] = [JOB_SEED, job.poster.as_ref(), &id, &bump];
        let signer: &[&[&[u8]]] = &[&seeds];
        token::transfer_checked(
            CpiContext::new_with_signer(
                self.token_program.key(),
                TransferChecked {
                    from: self.vault.to_account_info(),
                    mint: self.mint.to_account_info(),
                    to,
                    authority: job.to_account_info(),
                },
                signer,
            ),
            amount,
            self.mint.decimals,
        )
    }

    /// Closes the (empty) vault; its rent goes to `rent_to`, which callers always set to the poster.
    fn close(&self, rent_to: AccountInfo<'info>) -> Result<()> {
        let job = self.job;
        let id = job.job_id.to_le_bytes();
        let bump = [job.bump];
        let seeds: [&[u8]; 4] = [JOB_SEED, job.poster.as_ref(), &id, &bump];
        let signer: &[&[&[u8]]] = &[&seeds];
        token::close_account(CpiContext::new_with_signer(
            self.token_program.key(),
            CloseAccount {
                account: self.vault.to_account_info(),
                destination: rent_to,
                authority: job.to_account_info(),
            },
            signer,
        ))
    }

    /// Anything above `reward` was sent to the vault directly by someone. It leaves with the main transfer so the
    /// vault can always be closed (a token account only closes when empty).
    fn extra(&self) -> Result<u64> {
        self.vault.amount.checked_sub(self.job.reward).ok_or_else(|| error!(EscrowError::MathOverflow))
    }
}

pub struct Paid {
    /// Base units sent to the machine's ATA: `reward - fee` plus any extra that was in the vault.
    pub to_machine: u64,
    pub fee: u64,
}

/// The payout (§4.5): `reward - fee` to the machine's USDC ATA, `fee` to the treasury, stats updated, vault closed.
/// Anything above `reward` in the vault (a donation) also goes to the machine's ATA, so the vault can close, but only
/// `reward - fee` counts as `MachineStats.earned`: a donation can't buy a record.
/// If the treasury is this job's own vault (the admin named the job's PDA as treasury owner before the job existed),
/// the fee is waived (fee = 0, the machine gets the whole reward): a fee "sent" to the vault would stay in it and
/// block its close.
/// The caller's account constraints guarantee: the vault is the job's ATA for the config mint; `machine_token` is the
/// USDC ATA of `job.worker`; `treasury` is `config.treasury`; `rent_to` is `job.poster`.
pub fn pay_machine<'info>(
    vault: &Vault<'_, 'info>,
    machine_token: &Account<'info, TokenAccount>,
    treasury: &Account<'info, TokenAccount>,
    stats: &mut Account<'info, MachineStats>,
    rent_to: AccountInfo<'info>,
) -> Result<Paid> {
    let job = vault.job;
    let (earned, fee) =
        if treasury.key() == vault.vault.key() { (job.reward, 0) } else { split_reward(job.reward, job.fee_bps)? };
    let to_machine = earned.checked_add(vault.extra()?).ok_or(EscrowError::MathOverflow)?;

    vault.transfer(machine_token.to_account_info(), to_machine)?;
    if fee > 0 {
        vault.transfer(treasury.to_account_info(), fee)?;
    }

    stats.accepted = stats.accepted.checked_add(1).ok_or(EscrowError::MathOverflow)?;
    stats.earned = stats.earned.checked_add(earned).ok_or(EscrowError::MathOverflow)?;

    vault.close(rent_to)?;
    Ok(Paid { to_machine, fee })
}

/// The vault's whole balance back to the poster's USDC ATA (no fee), vault closed. Returns the amount refunded.
pub fn refund_poster<'info>(
    vault: &Vault<'_, 'info>,
    poster_token: &Account<'info, TokenAccount>,
    rent_to: AccountInfo<'info>,
) -> Result<u64> {
    let amount = vault.vault.amount;
    if amount > 0 {
        vault.transfer(poster_token.to_account_info(), amount)?;
    }
    vault.close(rent_to)?;
    Ok(amount)
}

#[cfg(test)]
mod tests {
    use super::split_reward;

    /// CLAUDE.md §13: every reward from 1 to 10,000,000 base units, `to_machine + fee == reward` and
    /// `fee == floor(reward * bps / 10_000)`, for the launch fee and the bounds.
    #[test]
    fn split_reward_holds_for_every_reward_up_to_ten_usdc() {
        for bps in [0u16, 1, 250, 499, 500] {
            for reward in 1..=10_000_000u64 {
                let (to_machine, fee) = split_reward(reward, bps).unwrap();
                assert_eq!(to_machine + fee, reward);
                assert_eq!(fee, reward * u64::from(bps) / 10_000);
            }
        }
    }

    #[test]
    fn split_reward_matches_the_prototype_numbers() {
        assert_eq!(split_reward(120_000_000, 250).unwrap(), (117_000_000, 3_000_000));
        assert_eq!(split_reward(80_000_000, 250).unwrap(), (78_000_000, 2_000_000));
    }

    #[test]
    fn split_reward_does_not_overflow_at_u64_max() {
        let (to_machine, fee) = split_reward(u64::MAX, 500).unwrap();
        assert_eq!(u128::from(fee), u128::from(u64::MAX) * 500 / 10_000);
        assert_eq!(to_machine.checked_add(fee), Some(u64::MAX));
    }
}
