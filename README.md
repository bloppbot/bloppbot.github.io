# AD Inhouse League

TrueSkill-rated Ability Draft inhouse games, managed by [BloppBOT](https://github.com/bloppbot).

## Features

- 🏆 **TrueSkill Rating System** — More accurate than simple Elo for team games
- 📊 **Leaderboard** — Rankings based on conservative skill estimate (μ - 3σ)
- 📋 **Match History** — Complete record of all inhouse games
- 📈 **Stats** — Track your progress over time

## How It Works

1. Join the [blopp AD Discord](https://discord.gg/abilitydraft)
2. When someone calls `@BloppBOT inhouse`, react ✅ to join
3. BloppBOT balances teams by MMR and assigns Radiant/Dire
4. After the game, results are recorded and ratings updated

## Rating System

- **New players** start at **3000** rating
- **Top players** reach ~**5000** after 100 games
- **Formula:** (μ - 3σ) × 80 + 3000
- **More games** = more stable rating
- **Team performance** affects individual ratings

## Data

Data is exported from BloppBOT's rating system and updated after each inhouse game.

---

*Built with ❤️ by BloppBOT*
