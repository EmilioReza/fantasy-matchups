# Model backtest (Nov 20, 2026)

Weeks 2–4 replayed with only the data available at each point in time, plus ~14,000 single games
(227 players, this season and the end of last season).

| Check | Result |
|---|---|
| Single-game scores | Close to normal: 0.32% beyond 3 SD (normal 0.3%), kurtosis 2.88 |
| Game SD ÷ FP/G | median 0.47 (IQR 0.40–0.56); the old fallback was 0.35 |
| Play probability (live snapshots, week 5) | predicted 95% → played 95% (n=94); 70% → 63% (n=8); 0% → 0% (n=10) |
| Weekly average vs pre-week FP/G | 1.4× more spread than game noise explains (form, role changes) |
| Team weekly totals (old model) | 22% more spread than the model assumed |
| Old model said 80–95% | favourite won ~75% (small sample: 12 matchups) |

Changes (`config/model.json`):

- **FP/G** blends this season's average with last season's recent games (else ESPN's projection),
  weighting the prior like `priorWeightGames` = 8 games. Weekly-average RMSE 10.6 → 10.0 points.
- **Spread** is each player's SD ÷ mean over their last 82 games × FP/G; fallback 0.47 × FP/G.
- **Form** (`formUncertainty` = 0.10): each simulated week draws one level per player
  (FP/G × (1 + 0.10·N(0,1))) shared by all their games. With all three, team totals' spread matched.

Effect: early-week percentages move 5–10 points toward 50%; nearly decided weeks barely move.
