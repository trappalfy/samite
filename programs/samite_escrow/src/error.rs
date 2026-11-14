use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    // config
    #[msg("Signer is not the program's upgrade authority")]
    NotUpgradeAuthority,
    #[msg("Signer is not the admin")]
    NotAdmin,
    #[msg("Signer is not the proposed admin")]
    NotPendingAdmin,
    #[msg("Fee is above MAX_FEE_BPS (500 = 5%)")]
    FeeTooHigh,
    #[msg("Minimum reward must be at least 1 base unit")]
    MinRewardZero,
    #[msg("Mint is not the configured USDC mint")]
    WrongMint,
    #[msg("Account is not the configured treasury")]
    WrongTreasury,
    #[msg("New posts and claims are paused")]
    Paused,

    // post_job
    #[msg("Reward is below the minimum reward")]
    RewardTooSmall,
    #[msg("Deadline must be between now + 1 hour and now + 90 days")]
    DeadlineOutOfRange,
    #[msg("Review window must be between 1 hour and 7 days")]
    ReviewWindowOutOfRange,
    #[msg("Claim window must be between 1 hour and the time left until the deadline")]
    ClaimWindowOutOfRange,
    #[msg("Allowlist must hold 1 to 10 addresses with the Allowlist policy, and be empty otherwise")]
    InvalidAllowlist,
    #[msg("Spec hash is missing")]
    SpecHashMissing,

    // job state
    #[msg("Signer is not this job's poster")]
    NotThePoster,
    #[msg("Job is not open")]
    JobNotOpen,
    #[msg("Job is not claimed")]
    JobNotClaimed,
    #[msg("Job has no delivery waiting for review")]
    JobNotDelivered,

    // claim
    #[msg("The deadline has passed")]
    DeadlinePassed,
    #[msg("A poster cannot claim their own job")]
    PosterCannotClaim,
    #[msg("This job is for proven machines: not enough accepted jobs yet")]
    NotProven,
    #[msg("Machine is not on this job's allowlist")]
    NotOnAllowlist,
    #[msg("Signer is not this job's machine")]
    NotTheWorker,
    #[msg("Account is not this job's machine")]
    WrongMachine,
    #[msg("This job has no claim window")]
    NoClaimWindow,
    #[msg("The claim window has not passed yet")]
    ClaimWindowNotPassed,

    // deliver / review
    #[msg("Delivery hash is missing")]
    DeliveryHashMissing,
    #[msg("This job already has the maximum number of deliveries")]
    TooManyDeliveries,
    #[msg("Rejection reason hash is missing")]
    ReasonHashMissing,
    #[msg("The review window has passed")]
    ReviewWindowPassed,
    #[msg("The review window has not passed yet")]
    ReviewWindowNotPassed,

    // refund
    #[msg("No refund while a delivery is waiting for review")]
    RefundWhileDelivered,
    #[msg("The deadline has not passed yet")]
    DeadlineNotPassed,

    #[msg("Arithmetic overflow")]
    MathOverflow,

    // Added for the review findings of Nov 12 (docs/PROGRAM-REVIEW.md), at the end so earlier codes stay the same.
    #[msg("This machine left this job (unclaimed, or its claim expired) and cannot claim it again")]
    CannotReclaim,
    #[msg("The treasury must be the treasury owner's USDC associated token account")]
    TreasuryNotOwnerAta,
    #[msg("The treasury owner cannot be an account owned by this program (such as a job)")]
    TreasuryOwnerIsProgramAccount,
    #[msg("Pass the new treasury owner and its USDC ATA together, or neither")]
    TreasuryOwnerAndAtaRequired,
    #[msg("The new admin cannot be the default (all-zero) address")]
    InvalidNewAdmin,
    #[msg("The job's vault already exists with a delegate or a close authority")]
    VaultHasDelegateOrCloseAuthority,
}
