// AD Inhouse League - Frontend App

document.addEventListener('DOMContentLoaded', () => {
    // Check if data is loaded
    if (typeof INHOUSE_DATA === 'undefined') {
        console.error('Data not loaded!');
        return;
    }

    renderStats();
    renderLeaderboard();
    renderMatches();
});

function renderStats() {
    const data = INHOUSE_DATA;
    const players = Object.keys(data.players);
    
    document.getElementById('total-players').textContent = players.length;
    document.getElementById('total-matches').textContent = data.matches.length;
    document.getElementById('last-updated').textContent = data.lastScraped 
        ? new Date(data.lastScraped).toLocaleDateString() 
        : 'Never';
}

function renderLeaderboard() {
    const data = INHOUSE_DATA;
    const tbody = document.getElementById('leaderboard-body');
    
    // Build leaderboard (show all registered players)
    // Rating formula: (μ - 3σ) × 80 + 3000
    // New players start at ~3000, top players reach ~5000 after 100 games
    const leaderboard = Object.entries(data.players)
        .map(([steamId, p]) => ({
            steamId,
            name: PLAYER_NAMES[steamId] || steamId,
            rating: Math.round((p.mu - 3 * p.sigma) * 80 + 3000),
            games: p.games,
            wins: p.wins,
            losses: p.losses,
            winrate: p.games > 0 ? Math.round((p.wins / p.games) * 100) : 0
        }))
        .sort((a, b) => b.rating - a.rating);
    
    if (leaderboard.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="no-data">No games played yet</td></tr>';
        return;
    }
    
    tbody.innerHTML = leaderboard.map((p, i) => {
        const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';
        const wrClass = p.winrate >= 60 ? 'winrate-high' : p.winrate >= 45 ? 'winrate-mid' : 'winrate-low';
        
        return `
            <tr>
                <td class="${rankClass}">#${i + 1}</td>
                <td>${escapeHtml(p.name)}</td>
                <td>${p.rating}</td>
                <td>${p.games}</td>
                <td>${p.wins}-${p.losses}</td>
                <td class="${wrClass}">${p.winrate}%</td>
            </tr>
        `;
    }).join('');
    
    // Update stats section
    if (leaderboard.length > 0) {
        const highest = leaderboard[0];
        document.getElementById('highest-rated').textContent = `${highest.name} (${highest.rating})`;
        
        const mostGames = [...leaderboard].sort((a, b) => b.games - a.games)[0];
        document.getElementById('most-games').textContent = `${mostGames.name} (${mostGames.games} games)`;
        
        const minGames = 3;
        const bestWR = [...leaderboard].filter(p => p.games >= minGames).sort((a, b) => b.winrate - a.winrate)[0];
        if (bestWR) {
            document.getElementById('best-winrate').textContent = `${bestWR.name} (${bestWR.winrate}%)`;
        }
    }
}

function renderMatches() {
    const data = INHOUSE_DATA;
    const container = document.getElementById('matches-list');
    
    if (data.matches.length === 0) {
        container.innerHTML = '<div class="no-data">No matches recorded yet</div>';
        return;
    }
    
    // Show last 10 matches, most recent first
    const recentMatches = [...data.matches].reverse().slice(0, 10);
    
    container.innerHTML = recentMatches.map(match => {
        const radiantNames = match.radiant.map(id => PLAYER_NAMES[id] || id.slice(-4)).join(', ');
        const direNames = match.dire.map(id => PLAYER_NAMES[id] || id.slice(-4)).join(', ');
        const date = new Date(match.date).toLocaleDateString();
        
        return `
            <div class="match-card">
                <div class="match-team radiant">
                    <div class="team-label radiant">Radiant ${match.winner === 'radiant' ? '🏆' : ''}</div>
                    <div class="team-players">${escapeHtml(radiantNames)}</div>
                </div>
                <div class="match-result">
                    <div class="match-vs">VS</div>
                    <div class="match-winner ${match.winner}">${match.winner.toUpperCase()} WINS</div>
                    <div class="match-date">${date}</div>
                </div>
                <div class="match-team dire">
                    <div class="team-label dire">Dire ${match.winner === 'dire' ? '🏆' : ''}</div>
                    <div class="team-players">${escapeHtml(direNames)}</div>
                </div>
            </div>
        `;
    }).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
