import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faUser, faShieldHalved } from '@fortawesome/free-solid-svg-icons'
import cardBackImg from './assets/card back.png'
import { CARD_COLORS, CARD_TYPES } from './data/cards.ts'
import {
  createGame,
  finishTurn,
  isCriticalState,
  isCardPlayable,
  isMirrorOnMirrorForbidden,
  MAX_GAUGE,
  playCards,
  replayCard,
  resolvePendingEffect,
  startNextRound,
} from './data/game.ts'
import { playBotTurn } from './data/bots.ts'
import TopBar from './TopBar.jsx'
import PlayHistory from './PlayHistory.jsx'
import './App.css'

const CARD_TYPE_LABELS = {
  [CARD_TYPES.OVERLOAD]: 'Overload',
  [CARD_TYPES.MIRROR]: 'Miroir',
  [CARD_TYPES.CHAOS]: 'Chaos',
}

const TARGETED_EFFECT_KINDS = new Set([
  'number-one-combo-target',
  'targeted-surcharge',
  'targeted-spy',
  'targeted-exchange',
  'targeted-surcharge-transfer',
  'targeted-threat',
])

function App() {
  const [game, setGame] = useState(null)
  const [selectedCardIds, setSelectedCardIds] = useState([])
  const [useSurcharge, setUseSurcharge] = useState(false)
  const [playError, setPlayError] = useState('')
  const [botError, setBotError] = useState('')
  const [autoPlay, setAutoPlay] = useState(true)
  const [threatChoice, setThreatChoice] = useState('surcharge')
  const [threatCardId, setThreatCardId] = useState('')
  const playerCount = game?.players.length
  const localPlayer = game?.players[0]
  const selectedCards = localPlayer
    ? selectedCardIds.map((id) => localPlayer.hand.find((card) => card.id === id))
    : []
  const isComboSelection = selectedCards.length === 2
  const selectedCardsArePlayable =
    game && selectedCards.length > 0 && (
      isComboSelection
        ? selectedCards.some((card) => isCardPlayable(card, game.discardPile, game.activeColor))
        : selectedCards.every((card) => isCardPlayable(card, game.discardPile, game.activeColor))
    )
  const requiresSurcharge =
    selectedCards.length > 0 && !selectedCardsArePlayable
  const isChoosingTarget =
    game?.pendingEffect?.playerIndex === 0 &&
    TARGETED_EFFECT_KINDS.has(game.pendingEffect.kind)
  const isReplayingCard =
    game?.pendingEffect?.kind === 'number-one-replay' &&
    game.pendingEffect.playerIndex === 0
  const isChoosingColor =
    game?.pendingEffect?.kind === 'choose-color' &&
    game.pendingEffect.playerIndex === 0
  const combosBlocked =
    game?.combosBlockedUntilTurn === game?.turnNumber
  const isChaosHumanPick = game?.pendingEffect?.kind === 'chaos-human-pick'
  const chaosNeighborIndex = game && playerCount
    ? (playerCount + game.turnDirection) % playerCount
    : 1
  const isBotTurn = Boolean(
    game &&
    game.currentPlayerIndex !== 0 &&
    !game.roundResult &&
    !game.matchResult &&
    !game.pendingEffect,
  )

  function executeBotTurn(currentGame) {
    try {
      const botIndex = currentGame.currentPlayerIndex
      const nextGame = playBotTurn(currentGame, botIndex)
      setBotError('')
      setSelectedCardIds([])
      setUseSurcharge(false)
      setGame((g) => g === currentGame ? nextGame : g)
    } catch (error) {
      setBotError(
        error instanceof Error
          ? error.message
          : "Un adversaire n'a pas pu jouer.",
      )
    }
  }

  function handleNextBot() {
    if (isBotTurn && !autoPlay && game) {
      executeBotTurn(game)
    }
  }

  useEffect(() => {
    if (!isBotTurn || !autoPlay) {
      return undefined
    }

    const timer = window.setTimeout(() => {
      executeBotTurn(game)
    }, 5000)

    return () => window.clearTimeout(timer)
  }, [game, autoPlay])

  function toggleCardSelection(card) {
    setPlayError('')
    setUseSurcharge(false)
    if (isMirrorOnMirrorForbidden(card, game.discardPile)) {
      setPlayError('Vous ne pouvez pas poser un Miroir sur un autre Miroir.')
      return
    }

    if (selectedCardIds.includes(card.id)) {
      setSelectedCardIds(selectedCardIds.filter((id) => id !== card.id))
      return
    }

    if (selectedCardIds.length === 0) {
      setSelectedCardIds([card.id])
      return
    }

    if (isReplayingCard) {
      setPlayError("Vous ne pouvez rejouer qu'une seule carte.")
      return
    }

    if (
      selectedCardIds.length === 1 &&
      selectedCards[0].type === CARD_TYPES.NUMBER &&
      card.type === CARD_TYPES.NUMBER &&
      selectedCards[0].value === card.value &&
      !combosBlocked &&
      !isCriticalState(localPlayer)
    ) {
      setSelectedCardIds([...selectedCardIds, card.id])
      return
    }

    if (isCriticalState(localPlayer)) {
      setPlayError(
        'En état critique, vous ne pouvez pas sélectionner un combo.',
      )
    } else if (combosBlocked) {
      setPlayError('Les combos sont bloqués pendant ce tour.')
    } else {
      setPlayError(
        selectedCardIds.length >= 2
          ? 'Vous ne pouvez sélectionner que deux cartes.'
          : 'Pour former un combo, choisissez deux cartes de même valeur.',
      )
    }
  }

  function handlePlayCards() {
    try {
      let nextGame = isReplayingCard
        ? replayCard(game, 0, selectedCardIds, useSurcharge)
        : playCards(game, 0, selectedCardIds, useSurcharge)
      const effect = nextGame.pendingEffect
      const isChaosEffect =
        effect?.kind === 'left-neighbor-swap' ||
        (
          effect?.kind === 'copy-last-effect' &&
          effect.copiedPlay?.cardType === CARD_TYPES.CHAOS
        )

      if (isChaosEffect) {
        nextGame = {
          ...nextGame,
          pendingEffect: { ...nextGame.pendingEffect, kind: 'chaos-human-pick' },
        }
      } else if (effect?.kind === 'copy-last-effect') {
        nextGame = resolvePendingEffect(nextGame)
      }

      setGame(
        !nextGame.pendingEffect && !nextGame.roundResult
          ? finishTurn(nextGame)
          : nextGame,
      )
      setSelectedCardIds([])
      setUseSurcharge(false)
      setPlayError('')
    } catch (error) {
      setPlayError(error.message)
    }
  }

  function handleTargetPlayer(targetPlayerIndex) {
    if (!game || !isChoosingTarget) {
      return
    }

    try {
      const resolvedGame = resolvePendingEffect(game, {
        targetPlayerIndex,
        threatChoice,
        offeredCardId: threatCardId,
      })
      setGame(
        resolvedGame.pendingEffect
          ? resolvedGame
          : finishTurn(resolvedGame),
      )
      setPlayError('')
      setThreatChoice('surcharge')
      setThreatCardId('')
    } catch (error) {
      setPlayError(
        error instanceof Error ? error.message : "L'effet n'a pas pu être appliqué.",
      )
    }
  }

  function handleChooseColor(color) {
    if (!game || !isChoosingColor) {
      return
    }

    try {
      const resolvedGame = resolvePendingEffect(game, { color })
      setGame(
        resolvedGame.pendingEffect
          ? resolvedGame
          : finishTurn(resolvedGame),
      )
      setPlayError('')
    } catch (error) {
      setPlayError(
        error instanceof Error ? error.message : "La couleur n'a pas pu être choisie.",
      )
    }
  }

  function handleChaosCardPick(cardId) {
    if (!game || !isChaosHumanPick) return
    try {
      const resolvedGame = resolvePendingEffect(game, { choiceCardId: cardId })
      setGame(resolvedGame.pendingEffect ? resolvedGame : finishTurn(resolvedGame))
      setPlayError('')
    } catch (error) {
      setPlayError(
        error instanceof Error ? error.message : "La carte n'a pas pu être récupérée.",
      )
    }
  }

  const revealedCardColor = game
    ? CARD_COLORS.find((color) => color.id === game.revealedCard.color)
    : null
  const tableColor = game
    ? CARD_COLORS.find(
      (color) => color.id === (
        game.activeColor === 'purple' ? 'purple' : game.activeColor
      ),
    )
    : null

  return (
    <main className="game-shell">
      <div className="game-main">
      <TopBar onHomeClick={() => {
        setGame(null)
        setBotError('')
        setThreatChoice('surcharge')
        setThreatCardId('')
        setSelectedCardIds([])
        setUseSurcharge(false)
        setPlayError('')
      }} />

      {!playerCount ? (
        <section className="setup-panel" aria-labelledby="setup-title">
          <div className="setup-emblem" aria-hidden="true">O</div>
          <p className="eyebrow">La table est à vous</p>
          <h1 id="setup-title">On lance une partie&nbsp;?</h1>
          <p className="setup-description">
            Réunissez les joueurs autour de la table et que la meilleure main
            l'emporte.
          </p>
          <label className="select-label" htmlFor="player-count">
            Nombre de joueurs
          </label>
          <select
            id="player-count"
            className="player-select"
            value=""
            onChange={(event) => {
              setGame(createGame(Number(event.target.value)))
              setBotError('')
              setThreatChoice('surcharge')
              setThreatCardId('')
              setSelectedCardIds([])
              setUseSurcharge(false)
              setPlayError('')
            }}
          >
            <option value="" disabled>Choisir entre 2 et 6 joueurs</option>
            {[2, 3, 4, 5, 6].map((count) => (
              <option key={count} value={count}>
                {count} joueurs
              </option>
            ))}
          </select>
          <span className="setup-hint">Vous serez placé en bas de la table.</span>
        </section>
      ) : (
        <section
          className="game-area"
          aria-label={`Table de jeu pour ${playerCount} joueurs`}
        >
          <div className="table-stage">
            {botError && (
              <span className="bot-error" role="alert">{botError}</span>
            )}
            <div
              className="game-table"
              style={{ '--table-color': tableColor.hex }}
            >
              <div className="table-ring">
                <div className="table-center">
                  {game.roundResult ? (
                    <div className="round-result" aria-live="polite">
                      <span className="table-subtitle">
                        {game.matchResult ? 'Fin de partie' : `Manche ${game.roundNumber} terminée`}
                      </span>
                      <span className="round-winner">
                        {game.matchResult
                          ? `${game.matchResult.winners.join(', ')} remporte${game.matchResult.winners.length > 1 ? 'nt' : ''} la partie`
                          : `${game.roundResult.winnerName} gagne la manche`}
                      </span>
                      {game.matchResult && (
                        <span className="match-trigger">
                          Seuil atteint par {game.matchResult.triggeredBy
                            .map((index) => game.players[index].name)
                            .join(', ')}
                        </span>
                      )}
                      <span className="round-score-title">
                        {game.matchResult ? 'Classement final' : 'Pénalités · total'}
                      </span>
                      <ul className="round-score-list">
                        {game.roundResult.penalties.map((penalty) => (
                          <li key={penalty.playerIndex}>
                            <span>{penalty.playerName}</span>
                            <span>
                              {game.roundResult.matchOver
                                ? `${game.roundResult.cumulativeScores[penalty.playerIndex]} pts`
                                : `+${penalty.totalPenalty} · ${game.roundResult.cumulativeScores[penalty.playerIndex]} pts`}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {!game.matchResult && (
                        <button
                          className="next-round-button"
                          type="button"
                          onClick={() => {
                            setGame(startNextRound(game))
                            setBotError('')
                            setThreatChoice('surcharge')
                            setThreatCardId('')
                            setSelectedCardIds([])
                            setUseSurcharge(false)
                            setPlayError('')
                          }}
                        >
                          Manche suivante
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <span className="table-subtitle">
                        Sens {game.turnDirection === 1 ? 'horaire' : 'antihoraire'}
                      </span>
                      <span className="table-player-count">
                        {playerCount} JOUEURS
                      </span>
                      <div
                        className="revealed-card"
                        style={{ '--card-color': revealedCardColor.hex }}
                        role="img"
                        aria-label={
                          game.revealedCard.type === CARD_TYPES.NUMBER
                            ? `Carte révélée : ${game.revealedCard.value} ${revealedCardColor.label.toLowerCase()}`
                            : `Carte révélée : ${CARD_TYPE_LABELS[game.revealedCard.type]}, ${revealedCardColor.label.toLowerCase()}`
                        }
                      >
                        <span className="revealed-card-color">
                          {revealedCardColor.label}
                        </span>
                        <span className={`revealed-card-face${game.revealedCard.type !== CARD_TYPES.NUMBER ? ' revealed-card-special' : ''}`}>
                          {game.revealedCard.type === CARD_TYPES.NUMBER
                            ? game.revealedCard.value
                            : CARD_TYPE_LABELS[game.revealedCard.type]}
                        </span>
                      </div>
                      <span className="revealed-card-caption">Première carte</span>
                      <span className="table-starter">
                        Commence : {game.players[game.startingPlayerIndex].name}
                      </span>
                      <span className="draw-pile">
                        Pioche · {game.drawPile.length} cartes
                        {game.lowDeckActive && ' · Panne générale ×2'}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
            {game.players.map((player, index) => {
              const isCurrentPlayer = index === game.currentPlayerIndex
              const angle = Math.PI / 2 + (index * 2 * Math.PI) / playerCount
              const x = 50 + Math.cos(angle) * 43
              const y = 50 + Math.sin(angle) * 43
              const handOnLeft = x < 50
              const isHandRevealed = player.handVisibleUntilTurn > game.turnNumber
              const isCritical = isCriticalState(player)

              return (
                <div
                  className={`player-seat${isCurrentPlayer ? ' player-seat-current' : ''}`}
                  key={player.id}
                  style={{ left: `${x}%`, top: `${y}%` }}
                  aria-label={`${player.name}, ${player.hand.length} cartes, jauge ${player.gauge} sur ${MAX_GAUGE}${isCurrentPlayer ? ', commence la partie' : ''}`}
                  role={
                    isChoosingTarget &&
                    game.pendingEffect.playerIndex !== index
                      ? 'button'
                      : undefined
                  }
                  tabIndex={
                    isChoosingTarget &&
                    game.pendingEffect.playerIndex !== index
                      ? 0
                      : undefined
                  }
                  onClick={() => {
                    if (
                      isChoosingTarget &&
                      game.pendingEffect.playerIndex !== index
                    ) {
                      handleTargetPlayer(index)
                    }
                  }}
                  onKeyDown={(event) => {
                    if (
                      isChoosingTarget &&
                      game.pendingEffect.playerIndex !== index &&
                      (event.key === 'Enter' || event.key === ' ')
                    ) {
                      event.preventDefault()
                      handleTargetPlayer(index)
                    }
                  }}
                >
                  <div className="player-tag">
                    <div className="player-tag-avatar">
                      <FontAwesomeIcon icon={faUser} aria-hidden="true" />
                    </div>
                    <span className="player-tag-name">{player.name}</span>
                    <span className="player-tag-shield" aria-hidden="true">
                      {player.shield && <FontAwesomeIcon icon={faShieldHalved} />}
                    </span>
                  </div>
                  {(isCritical || isHandRevealed) && (
                    <div className="player-status">
                      {isCritical && <span className="player-status-badge player-status-critical">État critique</span>}
                      {isHandRevealed && <span className="player-status-badge player-status-panne">Panne générale</span>}
                    </div>
                  )}
                  <div
                    className="player-gauge"
                    role="meter"
                    aria-label={`Jauge de ${player.name}`}
                    aria-valuemin={0}
                    aria-valuemax={MAX_GAUGE}
                    aria-valuenow={player.gauge}
                  >
                    {Array.from({ length: MAX_GAUGE }, (_, gaugeIndex) => (
                      <span
                        className={`gauge-segment${gaugeIndex < player.gauge ? ' gauge-segment-filled' : ''}`}
                        key={gaugeIndex}
                      />
                    ))}
                    <span className="gauge-value">
                      {player.gauge}/{MAX_GAUGE}
                    </span>
                  </div>
                  {isCurrentPlayer && (
                    <span className="player-turn">
                      {index === 0 ? 'À vous de jouer' : autoPlay ? 'Réfléchit…' : 'En attente'}
                    </span>
                  )}
                  {player.id !== 0 && (
                    <div
                      className={`opponent-hand${handOnLeft ? ' opponent-hand-left' : ''}${isHandRevealed ? ' opponent-hand-revealed' : ''}`}
                      role="group"
                      aria-label={`${isHandRevealed ? 'Main révélée' : 'Main cachée'} de ${player.name}, ${player.hand.length} cartes`}
                    >
                      {player.hand.map((card, cardIndex) => {
                        if (!isHandRevealed) {
                          const isPickable = isChaosHumanPick && index === chaosNeighborIndex
                          return (
                            <span
                              className={`opponent-card${isPickable ? ' opponent-card-pickable' : ''}`}
                              key={card.id}
                              style={{ '--card-index': cardIndex }}
                              role={isPickable ? 'button' : undefined}
                              tabIndex={isPickable ? 0 : undefined}
                              aria-label={isPickable ? 'Choisir cette carte' : undefined}
                              aria-hidden={!isPickable ? true : undefined}
                              onClick={isPickable ? () => handleChaosCardPick(card.id) : undefined}
                              onKeyDown={isPickable ? (event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault()
                                  handleChaosCardPick(card.id)
                                }
                              } : undefined}
                            >
                              <img src={cardBackImg} alt="" className="opponent-card-back" />
                            </span>
                          )
                        }

                        const color = CARD_COLORS.find(
                          (cardColor) => cardColor.id === card.color,
                        )
                        const label = card.type === CARD_TYPES.NUMBER
                          ? `${card.value} ${color.label.toLowerCase()}`
                          : `${CARD_TYPE_LABELS[card.type]}, ${color.label.toLowerCase()}`

                        return (
                          <span
                            className="opponent-card opponent-card-visible"
                            key={card.id}
                            style={{ '--card-color': color.hex, '--card-index': cardIndex }}
                            role="img"
                            aria-label={label}
                          >
                            <span className="opponent-card-color">{color.label}</span>
                            <span className={`opponent-card-value${card.type !== CARD_TYPES.NUMBER ? ' opponent-card-value-special' : ''}`}>
                              {card.type === CARD_TYPES.NUMBER
                                ? card.value
                                : CARD_TYPE_LABELS[card.type]}
                            </span>
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="local-hand" aria-label="Votre main">
            <span className="local-hand-label">Votre main</span>
            <div className="local-hand-cards">
              {game.players[0].hand.map((card, index) => {
                const color = CARD_COLORS.find(
                  (cardColor) => cardColor.id === card.color,
                )
                const label = card.type === CARD_TYPES.NUMBER
                  ? `${card.value} ${color.label.toLowerCase()}`
                  : `${CARD_TYPE_LABELS[card.type]}, ${color.label.toLowerCase()}`

                return (
                  <button
                    className={`hand-card${card.type !== CARD_TYPES.NUMBER ? ' hand-card-special' : ''}${selectedCardIds.includes(card.id) ? ' hand-card-selected' : ''}`}
                    key={card.id}
                    type="button"
                    disabled={game.currentPlayerIndex !== 0}
                    tabIndex={0}
                    aria-label={label}
                    aria-pressed={selectedCardIds.includes(card.id)}
                    aria-describedby={card.power ? `card-power-${card.id}` : undefined}
                    style={{
                      '--card-color': color.hex,
                      '--card-index': index,
                    }}
                    onClick={() => toggleCardSelection(card)}
                  >
                    <span className="opponent-card-color">{color.label}</span>
                    <span className={`opponent-card-value${card.type !== CARD_TYPES.NUMBER ? ' opponent-card-value-special' : ''}`} aria-hidden="true">
                      {card.type === CARD_TYPES.NUMBER ? card.value : CARD_TYPE_LABELS[card.type]}
                    </span>
                    {card.power && (
                      <span
                        className="card-power-tooltip"
                        id={`card-power-${card.id}`}
                        role="tooltip"
                      >
                        <span className="card-power-title">{card.power.name}</span>
                        <span className="card-power-section">
                          <span className="card-power-label">Effet simple</span>
                          <span>{card.power.simple}</span>
                        </span>
                        {card.power.combo && (
                          <span className="card-power-section">
                            <span className="card-power-label">Effet combo</span>
                            <span>{card.power.combo}</span>
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {game.currentPlayerIndex === 0 && !game.roundResult && (
              <div className="hand-actions">
                {isChoosingTarget && (
                  <span className="target-player-prompt" role="status">
                    {game.pendingEffect.kind === 'number-one-combo-target'
                      ? 'Cliquez sur le joueur qui piochera une carte, puis rejouez une carte.'
                      : game.pendingEffect.kind === 'targeted-spy'
                      ? 'Cliquez sur le joueur dont vous voulez voir la main.'
                      : game.pendingEffect.kind === 'targeted-exchange'
                        ? 'Cliquez sur un joueur pour échanger une carte au hasard.'
                        : game.pendingEffect.kind === 'targeted-surcharge-transfer'
                          ? 'Cliquez sur le joueur qui recevra votre surcharge.'
                          : 'Cliquez sur un joueur à cibler.'}
                  </span>
                )}
                {isChaosHumanPick && (
                  <span className="target-player-prompt" role="status">
                    Cliquez sur une carte face cachée de {game.players[chaosNeighborIndex].name} pour l'obtenir.
                  </span>
                )}
                {isReplayingCard && (
                  <span className="target-player-prompt" role="status">
                    Sélectionnez une carte valide à rejouer, puis cliquez sur « Rejouer ».
                  </span>
                )}
                {isChoosingColor && (
                  <div className="color-choice" role="group" aria-label="Choisir la couleur active">
                    <span>
                      {game.pendingEffect.isCombo
                        ? 'Choisissez une couleur. Les combos seront bloqués au prochain tour.'
                        : 'Choisissez la couleur active.'}
                    </span>
                    <div className="color-choice-options">
                      {CARD_COLORS.filter((color) => color.id !== 'purple').map((color) => (
                        <button
                          className="color-choice-button"
                          key={color.id}
                          type="button"
                          style={{ '--choice-color': color.hex }}
                          aria-label={color.label}
                          onClick={() => handleChooseColor(color.id)}
                        >
                          {color.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {game.pendingEffect?.kind === 'targeted-threat' && (
                  <label className="threat-choice">
                    <span>Effet de Menace</span>
                    <select
                      value={threatChoice}
                      onChange={(event) => setThreatChoice(event.target.value)}
                    >
                      <option value="surcharge">Lui infliger une surcharge</option>
                      <option value="card">Lui donner une de mes cartes</option>
                    </select>
                    {threatChoice === 'card' && (
                      <select
                        aria-label="Carte à donner"
                        value={threatCardId}
                        onChange={(event) => setThreatCardId(event.target.value)}
                      >
                        <option value="">Choisir la carte à donner</option>
                        {localPlayer.hand.map((card) => {
                          const color = CARD_COLORS.find(
                            (cardColor) => cardColor.id === card.color,
                          )
                          const label = card.type === CARD_TYPES.NUMBER
                            ? `${card.value} ${color.label.toLowerCase()}`
                            : `${CARD_TYPE_LABELS[card.type]}, ${color.label.toLowerCase()}`
                          return (
                            <option key={card.id} value={card.id}>{label}</option>
                          )
                        })}
                      </select>
                    )}
                  </label>
                )}
                {game.pendingEffect && !isReplayingCard && !isChoosingTarget && !isChoosingColor && (
                  <span className="play-error" role="status">
                    Cet effet nécessite une action avant le prochain tour.
                  </span>
                )}
                {requiresSurcharge && (
                  <label className="surcharge-choice">
                    <input
                      type="checkbox"
                      checked={useSurcharge}
                      onChange={(event) => setUseSurcharge(event.target.checked)}
                    />
                    <span>Ajouter 1 surcharge pour ignorer les règles de pose</span>
                  </label>
                )}
                {playError && (
                  <span className="play-error" role="status">{playError}</span>
                )}
              </div>
            )}
          </div>
        </section>
      )}
      {game && playerCount && (
        <div className="bottom-bar">
          <label className="bottom-bar-auto">
            <input
              type="checkbox"
              checked={autoPlay}
              onChange={(event) => setAutoPlay(event.target.checked)}
            />
            <span>Auto</span>
          </label>
          <button
            className="bottom-bar-btn bottom-bar-suivant"
            type="button"
            disabled={autoPlay || !isBotTurn}
            onClick={handleNextBot}
          >
            Suivant
          </button>
          <button
            className="bottom-bar-btn bottom-bar-jouer"
            type="button"
            disabled={
              game.currentPlayerIndex !== 0 ||
              Boolean(game.roundResult) ||
              selectedCardIds.length === 0 ||
              (Boolean(game.pendingEffect) && !isReplayingCard) ||
              (requiresSurcharge && !useSurcharge)
            }
            onClick={handlePlayCards}
          >
            {isReplayingCard
              ? 'Rejouer la carte'
              : `Jouer${isComboSelection ? ' le combo' : ' la carte'}`}
          </button>
        </div>
      )}
      </div>
      {game ? <PlayHistory playHistory={game.playHistory} /> : null}
    </main>
  )
}

export default App
