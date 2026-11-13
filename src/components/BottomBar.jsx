import './BottomBar.css'

export default function BottomBar({ autoPlay, onAutoPlayChange, isBotTurn, onNextBot, playDisabled, playLabel, onPlay }) {
  return (
    <div className="bottom-bar">
      <label className="bottom-bar-auto">
        <input
          type="checkbox"
          checked={autoPlay}
          onChange={(event) => onAutoPlayChange(event.target.checked)}
        />
        <span>Auto</span>
      </label>
      <button
        className="bottom-bar-btn bottom-bar-suivant"
        type="button"
        disabled={autoPlay || !isBotTurn}
        onClick={onNextBot}
      >
        Suivant
      </button>
      <button
        className="bottom-bar-btn bottom-bar-jouer"
        type="button"
        disabled={playDisabled}
        onClick={onPlay}
      >
        {playLabel}
      </button>
    </div>
  )
}
