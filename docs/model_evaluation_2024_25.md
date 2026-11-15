# Season evaluation: 2024/25

- Trained on 10781 matches from seasons before 2024; evaluated on 1752 matches.
- Model chosen by time-ordered CV on the training seasons: **logreg**; features: elo_diff, ewm_gd_diff, dc_p_home, dc_p_draw.

## Scores (lower is better, except accuracy)

| model | n | log_loss | brier | rps | accuracy |
|---|---|---|---|---|---|
| Bookmakers (margin removed) | 1752 | 0.9606 | 0.5706 | 0.1935 | 0.5479 |
| Average (pipeline + Elo + Dixon-Coles) | 1752 | 0.9822 | 0.5855 | 0.2000 | 0.5263 |
| Pipeline model (logreg) | 1752 | 0.9827 | 0.5858 | 0.2001 | 0.5280 |
| Dixon-Coles (raw) | 1752 | 0.9850 | 0.5870 | 0.2010 | 0.5234 |
| Elo only | 1752 | 0.9856 | 0.5878 | 0.2008 | 0.5303 |
| Historical frequencies | 1752 | 1.0774 | 0.6526 | 0.2327 | 0.4201 |

## Are the differences real? (average log-loss difference, 95% bootstrap interval)

Negative = better than the reference; if the interval contains 0 the models are tied.

Reference: **Elo only**

| model | diff | ci_low | ci_high | verdict |
|---|---|---|---|---|
| Pipeline model (logreg) | -0.0029 | -0.0075 | 0.0014 | tied |
| Historical frequencies | 0.0917 | 0.0715 | 0.1126 | worse |
| Dixon-Coles (raw) | -0.0006 | -0.0079 | 0.0068 | tied |
| Average (pipeline + Elo + Dixon-Coles) | -0.0035 | -0.0074 | 0.0004 | tied |
| Bookmakers (margin removed) | -0.0250 | -0.0342 | -0.0161 | better |

Reference: **Bookmakers (margin removed)**

| model | diff | ci_low | ci_high | verdict |
|---|---|---|---|---|
| Pipeline model (logreg) | 0.0221 | 0.0148 | 0.0296 | worse |
| Historical frequencies | 0.1168 | 0.0985 | 0.1359 | worse |
| Elo only | 0.0250 | 0.0161 | 0.0342 | worse |
| Dixon-Coles (raw) | 0.0244 | 0.0167 | 0.0324 | worse |
| Average (pipeline + Elo + Dixon-Coles) | 0.0216 | 0.0143 | 0.0292 | worse |

## Log loss by competition

| model | BL1 | FL1 | PD | PL | SA |
|---|---|---|---|---|---|
| Pipeline model (logreg) | 1.0213 | 0.9716 | 0.9693 | 0.9880 | 0.9685 |
| Historical frequencies | 1.0891 | 1.0521 | 1.0705 | 1.0804 | 1.0921 |
| Elo only | 1.0197 | 0.9733 | 0.9740 | 0.9887 | 0.9767 |
| Dixon-Coles (raw) | 1.0227 | 0.9734 | 0.9731 | 0.9896 | 0.9713 |
| Average (pipeline + Elo + Dixon-Coles) | 1.0189 | 0.9705 | 0.9703 | 0.9865 | 0.9694 |
| Bookmakers (margin removed) | 0.9882 | 0.9550 | 0.9463 | 0.9664 | 0.9513 |

Each league has only a few hundred matches, so do not rank close models within one league.

## Calibration of Pipeline model (logreg)

Predicted vs observed frequency in quantile bins; gaps under about 5 points are noise at this size.

Away win: average gap 2.7 points

| n | predicted | observed |
|---|---|---|
| 219 | 0.0874 | 0.0776 |
| 219 | 0.1500 | 0.1416 |
| 219 | 0.2055 | 0.2466 |
| 219 | 0.2591 | 0.2785 |
| 219 | 0.3154 | 0.3562 |
| 219 | 0.3884 | 0.3973 |
| 219 | 0.4875 | 0.5388 |
| 219 | 0.6396 | 0.6073 |

Draw: average gap 2.7 points

| n | predicted | observed |
|---|---|---|
| 219 | 0.1572 | 0.1553 |
| 219 | 0.2064 | 0.2603 |
| 219 | 0.2336 | 0.2100 |
| 219 | 0.2533 | 0.2877 |
| 219 | 0.2663 | 0.2329 |
| 219 | 0.2773 | 0.2603 |
| 219 | 0.2891 | 0.2603 |
| 219 | 0.3067 | 0.3288 |

Home win: average gap 1.7 points

| n | predicted | observed |
|---|---|---|
| 219 | 0.1549 | 0.1553 |
| 219 | 0.2464 | 0.2237 |
| 219 | 0.3260 | 0.2968 |
| 219 | 0.3933 | 0.3836 |
| 219 | 0.4593 | 0.4338 |
| 219 | 0.5311 | 0.4932 |
| 219 | 0.6212 | 0.6256 |
| 219 | 0.7451 | 0.7489 |

## Model selection (CV log loss on the training seasons)

| model | mean_log_loss |
|---|---|
| logreg | 0.9892 |
| moe_context | 0.9919 |
| random_forest | 0.9958 |
| hist_gb | 1.0021 |
| dummy_prior | 1.0764 |
