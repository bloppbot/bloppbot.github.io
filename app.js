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
                <td>
                    ${escapeHtml(p.name)}
                    <span class="player-links">
                        <a href="https://www.dotabuff.com/players/${p.steamId}" target="_blank" title="Dotabuff" class="link-dotabuff">
                            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18l6.9 3.45L12 11.09 5.1 7.63 12 4.18zM4 8.81l7 3.5v7.69l-7-3.5V8.81zm9 11.19v-7.69l7-3.5v7.69l-7 3.5z"/></svg>
                        </a>
                        <a href="https://www.opendota.com/players/${p.steamId}" target="_blank" title="OpenDota" class="link-opendota">
                            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                        </a>
                        <a href="https://windrun.io/players/${p.steamId}" target="_blank" title="Windrun (Ability Draft)" class="link-windrun">
                            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M14.5 17c0 1.65-1.35 3-3 3s-3-1.35-3-3h2c0 .55.45 1 1 1s1-.45 1-1-.45-1-1-1H2v-2h9.5c1.65 0 3 1.35 3 3zM19 6.5C19 4.57 17.43 3 15.5 3S12 4.57 12 6.5h2c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S16.33 8 15.5 8H2v2h13.5c1.93 0 3.5-1.57 3.5-3.5zm-.5 4.5H2v2h16.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5v2c1.93 0 3.5-1.57 3.5-3.5S20.43 11 18.5 11z"/></svg>
                        </a>
                    </span>
                </td>
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
