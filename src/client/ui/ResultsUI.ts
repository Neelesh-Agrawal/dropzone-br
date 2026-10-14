import { MatchSummaryStats } from '../../shared/types';

const clean = (s: string) => s.replace(/[&<>"']/g, '').replace('[BOT] ', '');

export class ResultsUI {
  private container: HTMLElement;
  private rootEl: HTMLElement;
  public onReturnToLobbyCallback?: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.rootEl = document.createElement('div');
    this.rootEl.id = 'results-root';
    this.container.appendChild(this.rootEl);
  }

  public show(winnerName: string, localPlayerId: string, stats: MatchSummaryStats[]): void {
    const me = stats.find(s => s.playerId === localPlayerId) || { placement: stats.length || 1, kills: 0, damage: 0, revives: 0, survivalTimeSeconds: 0, xpEarned: 0 };
    const victory = me.placement === 1;
    const solo = stats.length === 1;
    const time = `${Math.floor(me.survivalTimeSeconds / 60)}:${String(me.survivalTimeSeconds % 60).padStart(2, '0')}`;
    this.rootEl.className = `interactive visible ${victory ? 'victory' : 'defeat'}`;
    this.rootEl.innerHTML = `
      <section class="results-card" role="dialog" aria-label="Match results">
        <small class="results-kicker">${victory ? 'MATCH COMPLETE' : 'OPERATOR DOWN'}</small>
        <h1>${victory ? 'LAST ONE STANDING' : 'ELIMINATED'}</h1>
        <p class="results-sub">${victory ? 'Every other operator is down.' : `${solo ? 'Taken out by' : 'Match won by'} <b>${clean(winnerName)}</b>`}</p>
        <div class="results-placement"><span>PLACEMENT</span><strong>#${me.placement}</strong>${solo ? '' : `<em>of ${Math.max(stats.length, me.placement)}</em>`}</div>
        <div class="results-grid">
          <div><span>ELIMINATIONS</span><strong>${me.kills}</strong></div>
          <div><span>DAMAGE</span><strong>${Math.round(me.damage)}</strong></div>
          <div><span>SURVIVED</span><strong>${time}</strong></div>
          <div class="xp"><span>XP EARNED</span><strong>+${me.xpEarned}</strong></div>
        </div>
        <button id="btn-return-lobby">Return to lobby</button>
      </section>`;
    this.rootEl.querySelector('#btn-return-lobby')?.addEventListener('click', () => {
      this.hide();
      this.onReturnToLobbyCallback?.();
    });
  }

  public hide(): void {
    this.rootEl.className = '';
  }
}
