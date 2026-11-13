/**
 * Plain-language explanations that sit next to the on-chain numbers. Figures shown in
 * the UI always come from the contracts; this file only explains what they mean.
 */
export type RiskFactor = {
  name: string;
  level: 1 | 2 | 3 | 4 | 5;
  plain: string;
};

export type StrategyCopy = {
  yieldSource: string;
  howItWorks: string[];
  goodFor: string;
  withdrawals: string;
  risks: RiskFactor[];
  lossScenario: string;
};

export const STRATEGY_COPY: Record<number, StrategyCopy> = {
  1: {
    yieldSource:
      "A fixed rate paid from the vault's on-chain reward reserve. The reserve is funded by MezoFlow protocol fees and treasury top-ups, and you can see exactly how much is left.",
    howItWorks: [
      "Your MUSD sits in the vault contract. Nothing is lent out or traded.",
      "Every few minutes of activity, the vault moves earned interest from the reserve into the pool, so each share is worth a little more MUSD.",
      "When you withdraw, you burn shares and receive MUSD at the current share price.",
    ],
    goodFor: "Money you may need soon, or a first step into MezoFlow.",
    withdrawals: "Instant, at any time, with no exit fee.",
    risks: [
      {
        name: "Smart contract",
        level: 2,
        plain:
          "The vault is new code that has been tested and reviewed internally, but not audited by a third party. A bug could put deposits at risk.",
      },
      {
        name: "Yield source",
        level: 2,
        plain:
          "The rate is only paid while the reserve has MUSD in it. If the reserve runs dry, your balance stops growing, but your deposit is untouched.",
      },
      {
        name: "Liquidity",
        level: 1,
        plain: "All MUSD stays in the vault, so withdrawals never wait on another protocol.",
      },
    ],
    lossScenario:
      "Your MUSD principal is never moved anywhere else, so the realistic loss case is a smart contract bug, not market movement.",
  },
  2: {
    yieldSource:
      "A higher fixed rate paid from the vault's own on-chain reward reserve. Early-exit penalties are added back into that reserve, which helps fund the rate for people who stay.",
    howItWorks: [
      "Each deposit starts a 7-day lock on your position.",
      "If you add more later, the unlock date is re-weighted by size, so a small top-up only nudges it forward.",
      "After the unlock date you can withdraw freely. Before it you can still leave, minus a 1.5% penalty.",
    ],
    goodFor: "MUSD you know you will not touch for at least a week.",
    withdrawals: "Free after your unlock date. Before that, a 1.5% early-exit penalty applies.",
    risks: [
      {
        name: "Smart contract",
        level: 2,
        plain:
          "The vault is new code that has been tested and reviewed internally, but not audited by a third party. A bug could put deposits at risk.",
      },
      {
        name: "Lock-up",
        level: 2,
        plain:
          "Your shares cannot be transferred while locked, and leaving early costs 1.5% of what you withdraw.",
      },
      {
        name: "Yield source",
        level: 2,
        plain:
          "The rate is paid from a finite reserve. If it runs out before your lock ends, growth pauses but the lock still applies.",
      },
    ],
    lossScenario:
      "The only planned way to lose MUSD is exiting before your unlock date: 1.5% of the amount you withdraw goes to the reserve.",
  },
  3: {
    yieldSource:
      "BTC from liquidations. When a Mezo borrower's trove drops below 110% collateral, the Stability Pool repays its MUSD debt and receives its BTC collateral, usually worth more than the MUSD used.",
    howItWorks: [
      "The vault keeps 10% of deposits as idle MUSD and supplies the rest to Mezo's official MUSD Stability Pool.",
      "When troves are liquidated, part of the pooled MUSD is burned and the pool receives BTC in exchange.",
      "Your share of that BTC builds up in the vault. Claim it to your wallet whenever you like.",
    ],
    goodFor: "MUSD holders who want BTC upside and accept that returns arrive unevenly.",
    withdrawals:
      "The idle buffer can be withdrawn instantly. The rest can be withdrawn while no trove is below 110% collateral. 0.10% exit fee.",
    risks: [
      {
        name: "Principal conversion",
        level: 3,
        plain:
          "Liquidations swap some of your MUSD for BTC. Your MUSD balance can go down even while your total value goes up.",
      },
      {
        name: "BTC price",
        level: 3,
        plain:
          "The BTC you receive moves with the market. If BTC falls sharply after a liquidation and before you claim, the gain can turn into a loss.",
      },
      {
        name: "Withdrawal liquidity",
        level: 3,
        plain:
          "Mezo's Stability Pool blocks withdrawals while any trove is under 110% collateral. When that happens, only the 10% idle buffer is available until the trove is liquidated or topped up.",
      },
      {
        name: "Protocol dependency",
        level: 2,
        plain:
          "This strategy relies on Mezo's MUSD contracts (Stability Pool, TroveManager, price oracle) working as designed.",
      },
      {
        name: "Smart contract",
        level: 2,
        plain: "The MezoFlow vault wrapping the pool is new code that has been tested and reviewed internally, but not audited by a third party.",
      },
    ],
    lossScenario:
      "A trove liquidated at 110% collateral turns 100 MUSD of yours into about 110 MUSD of BTC. If BTC then drops more than about 9% before you sell, you are behind.",
  },
};
