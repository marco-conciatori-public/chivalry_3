// UI MANAGER: Handles DOM updates
const UiManager = {
    elements: {
        playerList: document.getElementById('player-list'),
        connectionStatus: document.getElementById('connection-status'),
        unitInfoContent: document.getElementById('unit-info-content'),
        logContent: document.getElementById('log-content'),
        endTurnBtn: document.getElementById('end-turn-btn'),
        contextMenu: document.getElementById('context-menu'),
        gameArea: document.getElementById('game-area'),
        status: document.getElementById('status'),
        toolbar: document.getElementById('toolbar'),
        btnRotate: document.getElementById('btn-rotate'),
        btnAttack: document.getElementById('btn-attack')
    },

    currentMoraleBreakdown: null,
    tooltipEl: null,

    init() {
        // Create Tooltip
        this.tooltipEl = document.createElement('div');
        this.tooltipEl.id = 'morale-tooltip';
        this.tooltipEl.style.display = 'none';
        document.body.appendChild(this.tooltipEl);
    },

    updateConnectionStatus(id) {
        this.elements.connectionStatus.innerText = `Connected as ID: ${id.substr(0,4)}...`;
    },

    updateStatus(gameState, myId) {
        if (gameState.turn === myId) {
            this.elements.status.innerText = "YOUR TURN";
            this.elements.status.style.color = "#27ae60";
        } else {
            const turnPlayer = gameState.players[gameState.turn];
            const turnName = turnPlayer ? turnPlayer.name : "Opponent";
            this.elements.status.innerText = `${turnName}'s Turn...`;
            this.elements.status.style.color = "#c0392b";
        }
    },

    updateLegend(gameState, myId, onRename) {
        if (!gameState.players) return;
        this.elements.playerList.innerHTML = '';
        Object.keys(gameState.players).forEach(id => {
            const p = gameState.players[id];
            const isMe = id === myId;
            const isTurn = gameState.turn === id;
            const li = document.createElement('li');
            li.className = 'player-item';
            if (isTurn) {
                li.style.border = '2px solid #333';
                li.style.fontWeight = 'bold';
            }
            const goldDisplay = p.gold !== undefined ? ` (${p.gold}g)` : '';
            const colorBox = document.createElement('div');
            colorBox.className = 'player-color-box';
            colorBox.style.backgroundColor = p.color;
            const nameSpan = document.createElement('span');
            nameSpan.innerText = `${p.name}${isMe ? " (You)" : ""}${goldDisplay}`;

            if (isMe) {
                nameSpan.style.cursor = 'pointer';
                nameSpan.title = 'Double-click to rename';
                nameSpan.ondblclick = (e) => {
                    e.stopPropagation();
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = p.name;
                    input.style.maxWidth = '100px';
                    input.style.padding = '2px';
                    input.style.border = '1px solid #aaa';
                    input.style.borderRadius = '3px';
                    const save = () => {
                        const newName = input.value.trim();
                        if (newName && newName !== p.name) onRename(newName);
                        else this.updateLegend(gameState, myId, onRename);
                    };
                    input.onblur = save;
                    input.onkeydown = (e) => {
                        if (e.key === 'Enter') save();
                        e.stopPropagation();
                    };
                    li.replaceChild(input, nameSpan);
                    input.focus();
                };
            }
            const turnMarker = document.createElement('span');
            turnMarker.className = 'current-turn-marker';
            turnMarker.innerText = isTurn ? 'TURN' : '';
            li.appendChild(colorBox);
            li.appendChild(nameSpan);
            li.appendChild(turnMarker);
            this.elements.playerList.appendChild(li);
        });
    },

    updateControls(gameState, myId, clientUnitStats) {
        const isMyTurn = gameState.turn === myId;
        const myPlayer = gameState.players[myId];
        this.elements.endTurnBtn.disabled = !isMyTurn;
        this.elements.toolbar.style.opacity = isMyTurn ? '1' : '0.5';
        this.elements.toolbar.style.pointerEvents = isMyTurn ? 'auto' : 'none';

        document.querySelectorAll('.template').forEach(el => {
            const type = el.dataset.type;
            const stats = clientUnitStats[type];
            if (stats && myPlayer) {
                if (myPlayer.gold < stats.cost) el.classList.add('disabled');
                else el.classList.remove('disabled');
                const icon = type === 'knight' ? '⚔️' : type === 'archer' ? '🏹' : type === 'wizard' ? '🧙' : '🏇';
                const name = type.charAt(0).toUpperCase() + type.slice(1);
                el.innerHTML = `${icon} ${name} <span style="font-size:0.8em; color:#666;">(${stats.cost}g)</span>`;
            }
        });
    },

    updateUnitInfo(entity, isTemplate, selectedTemplate, gameState, selectedCell) {
        this.currentMoraleBreakdown = null;
        if (!entity) {
            this.elements.unitInfoContent.innerHTML = '<em>Click a unit to see details</em>';
            return;
        }
        if (!isTemplate && entity.morale_breakdown) {
            this.currentMoraleBreakdown = entity.morale_breakdown;
        }

        const formatStat = (label, value) => `<div class="stat-row"><span>${label}:</span> <strong>${value}</strong></div>`;

        let typeDisplay = (isTemplate ? selectedTemplate : entity.type).toUpperCase();
        if (!isTemplate && entity.is_commander) typeDisplay += ' 👑';

        const healthDisplay = isTemplate ? entity.max_health : `${entity.current_health}/${entity.max_health}`;
        const movesDisplay = isTemplate ? entity.speed : `${entity.remainingMovement}/${entity.speed}`;

        let attacksRow = '';
        if (!isTemplate) {
            const attacksLeft = entity.hasAttacked ? 0 : 1;
            attacksRow = formatStat('Attacks', `${attacksLeft}/1`);
        }

        const moraleDisplay = isTemplate ? entity.initial_morale : `${entity.current_morale}/${entity.initial_morale}`;

        let moraleRow = '';
        if (!isTemplate) {
            moraleRow = `<div class="stat-row"><span id="morale-stat-label" class="interactive-label">Morale:</span> <strong>${moraleDisplay}</strong></div>`;
        } else {
            moraleRow = formatStat('Morale', moraleDisplay);
        }

        let bonusDisplay = (entity.bonus_vs && entity.bonus_vs.length > 0) ? entity.bonus_vs.join(', ') : 'None';
        let costRow = isTemplate ? formatStat('Cost', entity.cost || '-') : '';
        let extraRows = formatStat('Bonus against', bonusDisplay);

        let statusEffect = '';
        if (!isTemplate && entity.is_fleeing) statusEffect = `<div style="color:red; font-weight:bold; margin:5px 0;">⚠ FLEEING</div>`;
        else if (!isTemplate && entity.is_commander) statusEffect = `<div style="color:gold; font-weight:bold; margin:5px 0;">♛ COMMANDER</div>`;

        let terrainInfo = '';
        if (!isTemplate && selectedCell && gameState && gameState.terrainMap) {
            const t = gameState.terrainMap[selectedCell.y][selectedCell.x];
            if (t.id !== 'plains') {
                terrainInfo = `<hr style="margin:5px 0;"><div style="font-size:0.9em;">Terrain: ${t.symbol} <b>${t.id.toUpperCase()}</b><br>Def: +${t.defense}, Cost: ${t.cost}</div>`;
            }
        }

        this.elements.unitInfoContent.innerHTML = `
            <div style="font-size: 1.1em; font-weight: bold; margin-bottom: 5px;">${typeDisplay}</div>
            ${statusEffect}
            ${costRow}
            <hr style="border: 0; border-top: 1px solid #eee; margin: 8px 0;">
            ${formatStat('Health', healthDisplay)}
            ${formatStat('Moves', movesDisplay)}
            ${attacksRow}
            ${moraleRow}
            <hr style="border: 0; border-top: 1px solid #eee; margin: 8px 0;">
            ${formatStat('Attack', entity.attack)}
            ${formatStat('Defense', entity.defence)}
            ${formatStat('Range', entity.range)}
            ${extraRows}
            ${terrainInfo}
        `;

        if (!isTemplate) {
            const el = document.getElementById('morale-stat-label');
            if (el) {
                el.addEventListener('mouseenter', (e) => this.showMoraleTooltip(e));
                el.addEventListener('mousemove', (e) => this.moveTooltip(e));
                el.addEventListener('mouseleave', () => this.hideMoraleTooltip());
            }
        }
    },

    addLogEntry(msg, gameState, onUnitClick) {
        const div = document.createElement('div');
        div.className = 'log-entry';

        let formattedMsg = msg
            .replace(/{p:([^}]+)}/g, '<span class="log-player">$1</span>')
            .replace(/{u:([^:]+):(\d+):(\d+):([^}]+)}/g, (match, type, x, y, ownerId) => {
                const color = gameState.players[ownerId] ? gameState.players[ownerId].color : '#3498db';
                return `<span class="log-unit" style="color: ${color}" data-x="${x}" data-y="${y}">${type}</span>`;
            });

        div.innerHTML = formattedMsg;

        div.querySelectorAll('.log-unit').forEach(span => {
            span.onclick = () => {
                const x = parseInt(span.dataset.x);
                const y = parseInt(span.dataset.y);
                onUnitClick(x, y);
            };
        });

        this.elements.logContent.appendChild(div);
        this.elements.logContent.scrollTop = this.elements.logContent.scrollHeight;
    },

    showFloatingText(gridX, gridY, text, color, cellSize) {
        const el = document.createElement('div');
        el.className = 'floating-text';
        el.innerText = text;
        el.style.color = color;

        const jitterX = (Math.random() * 20) - 10;
        const jitterY = (Math.random() * 20) - 10;

        // Calculate position relative to Game Area
        // Need to account for Canvas size being different from Grid coords
        const left = (gridX * cellSize) + (cellSize / 2) + jitterX;
        const top = (gridY * cellSize) + (cellSize / 2) + jitterY;

        // Position it
        // The game-area is position:relative, so we can position absolutely inside it
        // BUT current structure appends to game-area directly.
        // We need to account for sidebar offset if not inside game area.
        // Assuming game-area is the parent:
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;

        this.elements.gameArea.appendChild(el);
        setTimeout(() => { el.remove(); }, 1500);
    },

    showContextMenu(clientX, clientY, entity, selectedCell, cellSize) {
        if (entity) {
            this.elements.btnRotate.disabled = entity.remainingMovement < 1;
            this.elements.btnAttack.disabled = entity.hasAttacked;
        }

        const gameAreaRect = this.elements.gameArea.getBoundingClientRect();

        if (selectedCell) {
            const menuLeft = (selectedCell.x * cellSize) + cellSize + 5;
            const menuTop = (selectedCell.y * cellSize);
            this.elements.contextMenu.style.left = `${menuLeft}px`;
            this.elements.contextMenu.style.top = `${menuTop}px`;
        } else {
            this.elements.contextMenu.style.left = `${clientX - gameAreaRect.left}px`;
            this.elements.contextMenu.style.top = `${clientY - gameAreaRect.top}px`;
        }
        this.elements.contextMenu.style.display = 'flex';
    },

    hideContextMenu() {
        this.elements.contextMenu.style.display = 'none';
    },

    showMoraleTooltip(e) {
        if (!this.currentMoraleBreakdown || this.currentMoraleBreakdown.length === 0) return;
        let html = '';
        this.currentMoraleBreakdown.forEach(item => {
            const colorClass = item.value >= 0 ? 'positive' : 'negative';
            const sign = item.value >= 0 ? '+' : '';
            html += `<div class="tooltip-row"><span>${item.label}</span><span class="tooltip-val ${colorClass}">${sign}${item.value}</span></div>`;
        });
        this.tooltipEl.innerHTML = html;
        this.tooltipEl.style.display = 'block';
        this.moveTooltip(e);
    },

    moveTooltip(e) {
        this.tooltipEl.style.left = `${e.pageX + 15}px`;
        this.tooltipEl.style.top = `${e.pageY + 15}px`;
    },

    hideMoraleTooltip() {
        this.tooltipEl.style.display = 'none';
    }
};