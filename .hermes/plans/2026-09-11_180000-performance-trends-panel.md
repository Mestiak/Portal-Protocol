# Future Idea: Performance Trends Panel

## Concept

A panel in the Analytics tab that shows data-driven performance trends and improvement recommendations for a selected account across multiple selected logs.

## Refined Features

### Role Detection
Auto-detect player role from profession + elite spec + boon uptime:
- **DPS**: Low boon uptime, high damage
- **Boon DPS**: High boon uptime (Quickness/Alacrity), moderate damage (e.g., Quickness Firebrand, Alacrity Renegade)
- **Healer**: High boon uptime, healing spec, low damage

### Recommendations by Role

**DPS Players:**
- DPS trend sparkline across logs ("DPS: 35k → 42k, +20%")
- Worst recurring mechanic ("Failed Cry of Rage 3/5 logs")
- DPS vs squad percentile ("You rank 3/10 in DPS")
- Phase-specific weakness ("Phase 3 DPS is 15% lower than Phase 1-2")

**Boon DPS Players:**
- Boon uptime trend (primary metric: "Quickness: 92% → 87% → 84%, declining")
- DPS trend (secondary)
- Boon gap vs target ("Quickness 87% vs 94% squad average")
- Tradeoff warning ("DPS top 25% but Quickness bottom 40%")

**Healers:**
- Boon uptime trend (Quickness, Might, Alacrity)
- Healing throughput trend
- Death count trend ("You died 2x avg per log")
- Might stacks avg ("Avg 20 stacks, recommended 25")

## Feasibility

### Already Available
- Multi-log selection in Analytics tab
- Per-player metrics: DPS, boon uptime, healing, deaths (in `UploadRecord.players`)
- Mechanic failures (from EI `mechanics[]`)
- Account filtering

### Needs Building
1. **Aggregation layer** — query selected logs, group by account, compute trends
2. **Role classifier** — detect DPS / Boon DPS / Healer from profession + spec + boons
3. **Recommendation engine** — compare player history vs squad averages
4. **UI panel** — trend sparklines + recommendation cards below existing Analytics charts

## Estimated Effort
2-3 days for v1.

## Key Design Principles
- **Trend > absolute**: "Improving from 35k → 42k" is more useful than "Your DPS is 40k"
- **Squad context**: "Quickness 87%, squad avg 94%, rank 8/10" drives action
- **Actionable**: Each recommendation should point to a specific, fixable issue
