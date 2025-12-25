// UI MANAGER: Handles DOM updates
const UiManager = {
    elements: {
        playerList: document.getElementById('player-list'),
        connectionStatus: document.getElementById('connection-status'),
        unitInfoContent: document.getElementById('unit-info-content'),
        cellInfoContent: document.getElementById('cell-info-content'),
        logContent: document.getElementById('log-content'),
        endTurnBtn: document.getElementById('end-turn-btn'),
        contextMenu: document.getElementById('context-menu'),
        gameArea: document.getElementById('game-area'),
        status: document.getElementById('status'),
        toolbar: document.getElementById('toolbar'),
        btnRotate: document.getElementById('btn-rotate'),
        btnAttack: document.getElementById('btn-attack'),
        setupScreen: document.getElementById('setup-screen'),
        btnStartGame: document.getElementById('btn-start-game'),
        btnNewGameTrigger: document.getElementById('btn-new-game-trigger')
    },

    currentMoraleBreakdown: null,
    currentAttackBreakdown: null,
    currentDefenseBreakdown: null,
    tooltipEl: null,
    gameConstants: null,

    init() {
        // Create Tooltip
        this.tooltipEl = document.createElement('div');
        this.tooltipEl.id = 'morale-tooltip';
        this.tooltipEl.style.display = 'none';
        document.body.appendChild(this.tooltipEl);

        // Setup Screen listeners are wired in game.js, but we provide methods here
        this.elements.btnNewGameTrigger.addEventListener('click', () => {
            if (confirm("Are you sure you want to start a new game? Current progress will be lost.")) {
                this.showSetupScreen();
            }
        });
    },

    setConstants(constants) {
        this.gameConstants = constants;
    },

    showSetupScreen() {
        this.elements.setupScreen.classList.remove('hidden');
    },

    hideSetupScreen() {
        this.elements.setupScreen.classList.add('hidden');
    },

    getSetupSettings() {
        return {
            gridSize: document.getElementById('cfg-grid-size').value,
            startingGold: document.getElementById('cfg-gold').value,
            aiCount: document.getElementById('cfg-ai-count').value,
            aiDifficulty: document.getElementById('cfg-ai-difficulty').value
        };
    },

    updateConnectionStatus(id) {
        this.elements.connectionStatus.innerText = `Connected as ID: ${id.substr(0,4)}...`;
    },

    updateStatus(gameState, myId) {
        // Default to Turn 1 if undefined (backward compatibility/safety)
        const turnCount = gameState.turnCount || 1;

        if (gameState.turn === myId) {
            this.elements.status.innerText = `Turn ${turnCount}: YOUR TURN`;
            this.elements.status.style.color = "#27ae60";
        } else {
            const turnPlayer = gameState.players[gameState.turn];
            const turnName = turnPlayer ? turnPlayer.name : "Opponent";
            this.elements.status.innerText = `Turn ${turnCount}: ${turnName}'s Turn...`;
            this.elements.status.style.color = "#c0392b";
        }
    },

    updateLegend(gameState, myId, onRename) {
        if (!gameState.players) return;

        this.updateLogNames(gameState);

        this.elements.playerList.innerHTML = '';
        Object.keys(gameState.players).forEach(id => {
            const p = gameState.players[id];
            const isMe = id === myId;
            const isTurn = gameState.turn === id;
            const li = document.createElement('li');
            li.className = 'player-item';

            // Flex layout for positioning
            li.style.display = 'flex';
            li.style.alignItems = 'center';

            if (isTurn) {
                li.style.border = '2px solid #333';
                li.style.fontWeight = 'bold';
            }

            const colorBox = document.createElement('div');
            colorBox.className = 'player-color-box';
            colorBox.style.backgroundColor = p.color;
            colorBox.style.marginRight = '8px'; // Add spacing

            const nameSpan = document.createElement('span');

            let displayName = p.name;
            if (isMe) displayName += " (You)";
            if (p.isAI) displayName += " [AI]";

            nameSpan.innerText = displayName;

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

            // Gold on the right
            const goldSpan = document.createElement('span');
            goldSpan.innerText = p.gold !== undefined ? `${p.gold}g` : '';
            goldSpan.style.marginLeft = 'auto'; // Push to right
            goldSpan.style.fontWeight = 'bold';
            goldSpan.style.color = '#b7950b';

            li.appendChild(colorBox);
            li.appendChild(nameSpan);
            li.appendChild(goldSpan);

            this.elements.playerList.appendChild(li);
        });
    },

    // NEW: Updates all player name spans in the log based on current game state
    updateLogNames(gameState) {
        const playerSpans = this.elements.logContent.querySelectorAll('.log-player');
        playerSpans.forEach(span => {
            const playerId = span.getAttribute('data-id');
            if (playerId && gameState.players[playerId]) {
                const currentName = gameState.players[playerId].name;
                if (span.innerText !== currentName) {
                    span.innerText = currentName;
                }
            }
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

                // UPDATED: Icons for new units
                let icon = '❓';
                if (type === 'light_infantry') icon = '⚔️';
                else if (type === 'heavy_infantry') icon = '🛡️';
                else if (type === 'archer') icon = '🏹';
                else if (type === 'light_cavalry') icon = '🐎';
                else if (type === 'heavy_cavalry') icon = '🏇';
                else if (type === 'lancer') icon = '🔱';

                // Format Name
                const name = type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

                el.innerHTML = `${icon} ${name} <span style="font-size:0.8em; color:#666;">(${stats.cost}g)</span>`;
            }
        });
    },

    updateCellInfo(terrain, x, y) {
        if (!terrain) {
            this.elements.cellInfoContent.innerHTML = '<em>Hover over a cell</em>';
            return;
        }

        const formatStat = (label, value) => `<div class="stat-row"><span>${label}:</span> <strong>${value}</strong></div>`;

        let effects = [];
        // Removed redundant display of defense and cost values
        // Removed "Impassable" from effects list as requested
        if (terrain.blocksLos) effects.push(`Blocks Sight`);
        if (terrain.highGround) effects.push(`High Ground (+ range, + attack)`);

        let effectsHtml = effects.length > 0 ? effects.join(', ') : '';

        // Only show footer if there are effects
        let footerHtml = '';
        if (effects.length > 0) {
            footerHtml = `
            <hr style="border: 0; border-top: 1px solid #eee; margin: 8px 0;">
            <div style="font-size: 0.9em; color: #555;">${effectsHtml}</div>
            `;
        }

        // Logic for Movement Cost display
        let moveCostDisplay = terrain.cost;
        if (terrain.cost >= 99) {
            moveCostDisplay = "Impassable";
        }

        this.elements.cellInfoContent.innerHTML = `
            <div style="font-size: 1.1em; font-weight: bold; margin-bottom: 5px;">${terrain.id.toUpperCase()} <span style="font-size:0.8em">(${x},${y})</span></div>
            ${formatStat('Movement Cost', moveCostDisplay)}
            ${formatStat('Defense Bonus', terrain.defense + '%')}
            ${footerHtml}
        `;
    },

    updateUnitInfo(entity, isTemplate, selectedTemplate, gameState, selectedCell) {
        this.currentMoraleBreakdown = null;
        this.currentAttackBreakdown = null;
        this.currentDefenseBreakdown = null;

        if (!entity) {
            this.elements.unitInfoContent.innerHTML = '<em>Click a unit to see details</em>';
            return;
        }
        if (!isTemplate && entity.morale_breakdown) {
            this.currentMoraleBreakdown = entity.morale_breakdown;
        }

        const formatStat = (label, value) => `<div class="stat-row"><span>${label}:</span> <strong>${value}</strong></div>`;

        let typeName = isTemplate ? selectedTemplate : entity.type;
        // Format Name (replace _ with space and capitalize)
        let typeDisplay = typeName.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

        if (!isTemplate && entity.is_commander) typeDisplay += ' 👑';

        const healthDisplay = isTemplate ? entity.max_health : `${entity.current_health}/${entity.max_health}`;
        const movesDisplay = isTemplate ? entity.speed : `${entity.remainingMovement}/${entity.speed}`;

        let attacksRow = '';
        if (!isTemplate) {
            const attacksLeft = entity.hasAttacked ? 0 : 1;
            attacksRow = formatStat('Attacks', `${attacksLeft}/1`);
        }

        const moraleDisplay = isTemplate ? entity.initial_morale : `${entity.current_morale}/${entity.initial_morale}`;

        // Helper style for interactive tooltips (dotted underline)
        const interactiveStyle = 'border-bottom: 1px dotted #888; cursor: help; display: inline-block; line-height: 1.2;';

        let moraleRow = '';
        if (!isTemplate) {
            moraleRow = `<div class="stat-row"><span id="morale-stat-label" class="interactive-label" style="${interactiveStyle}">Morale:</span> <strong>${moraleDisplay}</strong></div>`;
        } else {
            moraleRow = formatStat('Morale', moraleDisplay);
        }

        // Conditional Stats & Dynamic Calculations
        let attackValue = entity.attack;
        let defenseValue = entity.defence;
        let shieldBonus = entity.shield_bonus || 0;

        let dynamicAttackDisplay = attackValue;
        let dynamicDefenseDisplay = defenseValue;

        // Initialize breakdowns if unit is on grid
        if (!isTemplate) {
            this.currentAttackBreakdown = [{ label: "Base Attack", value: attackValue }];
            this.currentDefenseBreakdown = [{ label: "Base Defense", value: defenseValue }];
        }

        // Calculate dynamic bonuses for units on the grid
        if (!isTemplate && gameState && gameState.terrainMap && selectedCell) {
            const terrain = gameState.terrainMap[selectedCell.y][selectedCell.x];
            if (terrain) {
                // Attack Bonus (High Ground)
                if (terrain.highGround) {
                    const highGroundBonus = (this.gameConstants) ? this.gameConstants.BONUS_HIGH_GROUND_ATTACK : 10;
                    const totalAttack = attackValue + highGroundBonus;
                    dynamicAttackDisplay = `${attackValue} <span style="color:#27ae60; font-size: 0.9em;">(${totalAttack})</span>`;
                    this.currentAttackBreakdown.push({ label: "High Ground", value: highGroundBonus });
                }

                // Defense Bonus (Terrain + Shield)
                const terrainDefense = terrain.defense || 0;

                if (shieldBonus > 0) this.currentDefenseBreakdown.push({ label: "Shield", value: shieldBonus });
                if (terrainDefense > 0) this.currentDefenseBreakdown.push({ label: "Terrain", value: terrainDefense });

                const totalDefense = defenseValue + shieldBonus + terrainDefense;

                if (totalDefense !== defenseValue) {
                    dynamicDefenseDisplay = `${defenseValue} <span style="color:#555; font-size: 0.9em;">(${totalDefense})</span>`;
                }
            }
        } else if (shieldBonus > 0) {
            // For templates or fallback, just show shield bonus if present
            const totalDefense = defenseValue + shieldBonus;
            dynamicDefenseDisplay = `${defenseValue} <span style="color:#555; font-size: 0.9em;">(${totalDefense})</span>`;
        }

        let attackRowHtml = '';
        let defenseRowHtml = '';

        if (!isTemplate) {
            attackRowHtml = `<div class="stat-row"><span id="attack-stat-label" class="interactive-label" style="${interactiveStyle}">Attack:</span> <strong>${dynamicAttackDisplay}</strong></div>`;
            defenseRowHtml = `<div class="stat-row"><span id="defense-stat-label" class="interactive-label" style="${interactiveStyle}">Defense:</span> <strong>${dynamicDefenseDisplay}</strong></div>`;
        } else {
            attackRowHtml = formatStat('Attack', dynamicAttackDisplay);
            defenseRowHtml = formatStat('Defense', dynamicDefenseDisplay);
        }

        let rangeRows = '';
        if (entity.is_ranged) {
            rangeRows += formatStat('Range', entity.range);
            rangeRows += formatStat('Accuracy', entity.accuracy + '%');
        }

        let chargeRow = '';
        if (entity.charge_bonus > 0) {
            chargeRow = formatStat('Charge Bonus', entity.charge_bonus);
        }

        // Properly Format Abilities (Hidden if empty)
        let abilitiesRow = '';
        if (entity.special_abilities && entity.special_abilities.length > 0) {
            const abilitiesDisplay = entity.special_abilities.map(ability =>
                ability.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
            ).join(', ');
            abilitiesRow = formatStat('Abilities', abilitiesDisplay);
        }

        let costRow = isTemplate ? formatStat('Cost', entity.cost || '-') : '';

        let statusEffect = '';
        if (!isTemplate && entity.is_fleeing) statusEffect = `<div style="color:red; font-weight:bold; margin:5px 0;">⚠ FLEEING</div>`;
        else if (!isTemplate && entity.is_commander) statusEffect = `<div style="color:gold; font-weight:bold; margin:5px 0;">♛ COMMANDER</div>`;

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
            ${attackRowHtml}
            ${defenseRowHtml}
            ${chargeRow}
            ${rangeRows}
            ${abilitiesRow}
        `;

        if (!isTemplate) {
            const moraleEl = document.getElementById('morale-stat-label');
            if (moraleEl) {
                moraleEl.addEventListener('mouseenter', (e) => this.showMoraleTooltip(e));
                moraleEl.addEventListener('mousemove', (e) => this.moveTooltip(e));
                moraleEl.addEventListener('mouseleave', () => this.hideTooltip());
            }

            const attackEl = document.getElementById('attack-stat-label');
            if (attackEl) {
                attackEl.addEventListener('mouseenter', (e) => this.showAttackTooltip(e));
                attackEl.addEventListener('mousemove', (e) => this.moveTooltip(e));
                attackEl.addEventListener('mouseleave', () => this.hideTooltip());
            }

            const defenseEl = document.getElementById('defense-stat-label');
            if (defenseEl) {
                defenseEl.addEventListener('mouseenter', (e) => this.showDefenseTooltip(e));
                defenseEl.addEventListener('mousemove', (e) => this.moveTooltip(e));
                defenseEl.addEventListener('mouseleave', () => this.hideTooltip());
            }
        }
    },

    clearLog() {
        this.elements.logContent.innerHTML = '';
    },

    addLogEntry(msg, gameState, onUnitClick) {
        const div = document.createElement('div');
        div.className = 'log-entry';

        // Parse {p:PLAYER_ID} and store ID in data attribute for dynamic updates
        let formattedMsg = msg
            .replace(/{p:([^}]+)}/g, (match, playerId) => {
                const p = gameState.players[playerId];
                const name = p ? p.name : 'Unknown';
                // Store ID for future updates
                return `<span class="log-player" data-id="${playerId}">${name}</span>`;
            })
            .replace(/{u:([^:]+):(\d+):(\d+):([^}]+)}/g, (match, type, x, y, ownerId) => {
                const color = gameState.players[ownerId] ? gameState.players[ownerId].color : '#3498db';
                // Clean up type name for log
                const cleanType = type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                return `<span class="log-unit" style="color: ${color}" data-x="${x}" data-y="${y}">${cleanType}</span>`;
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

    getVisualCellSize(internalCellSize) {
        const canvas = document.getElementById('gameCanvas');
        if (!canvas) return internalCellSize;
        const rect = canvas.getBoundingClientRect();
        // Calculate scale factor (Display Width / Internal Width)
        const scale = rect.width / canvas.width;
        return internalCellSize * scale;
    },

    showFloatingText(gridX, gridY, text, color, internalCellSize) {
        const el = document.createElement('div');
        el.className = 'floating-text';
        el.innerText = text;
        el.style.color = color;

        // Calculate Visual Scale
        const visualCellSize = this.getVisualCellSize(internalCellSize);

        const jitterX = (Math.random() * 20) - 10;
        const jitterY = (Math.random() * 20) - 10;

        const left = (gridX * visualCellSize) + (visualCellSize / 2) + jitterX;
        const top = (gridY * visualCellSize) + (visualCellSize / 2) + jitterY;

        el.style.left = `${left}px`;
        el.style.top = `${top}px`;

        this.elements.gameArea.appendChild(el);
        setTimeout(() => { el.remove(); }, 1500);
    },

    showContextMenu(clientX, clientY, entity, selectedCell, internalCellSize) {
        if (entity) {
            this.elements.btnRotate.disabled = entity.remainingMovement < 1;
            this.elements.btnAttack.disabled = entity.hasAttacked;
        }

        const gameAreaRect = this.elements.gameArea.getBoundingClientRect();

        if (selectedCell) {
            // Calculate Visual Scale
            const visualCellSize = this.getVisualCellSize(internalCellSize);

            // Position relative to the cell
            const menuLeft = (selectedCell.x * visualCellSize) + visualCellSize + 5;
            const menuTop = (selectedCell.y * visualCellSize);
            this.elements.contextMenu.style.left = `${menuLeft}px`;
            this.elements.contextMenu.style.top = `${menuTop}px`;
        } else {
            // Position at mouse click (already screen coords)
            this.elements.contextMenu.style.left = `${clientX - gameAreaRect.left}px`;
            this.elements.contextMenu.style.top = `${clientY - gameAreaRect.top}px`;
        }
        this.elements.contextMenu.style.display = 'flex';
    },

    hideContextMenu() {
        this.elements.contextMenu.style.display = 'none';
    },

    renderTooltip(e, breakdown) {
        if (!breakdown || breakdown.length === 0) return;
        let html = '';
        breakdown.forEach(item => {
            const colorClass = item.value >= 0 ? 'positive' : 'negative';
            const sign = item.value >= 0 ? '+' : '';
            html += `<div class="tooltip-row"><span>${item.label}</span><span class="tooltip-val ${colorClass}">${sign}${item.value}</span></div>`;
        });
        this.tooltipEl.innerHTML = html;
        this.tooltipEl.style.display = 'block';
        this.moveTooltip(e);
    },

    showMoraleTooltip(e) {
        this.renderTooltip(e, this.currentMoraleBreakdown);
    },

    showAttackTooltip(e) {
        this.renderTooltip(e, this.currentAttackBreakdown);
    },

    showDefenseTooltip(e) {
        this.renderTooltip(e, this.currentDefenseBreakdown);
    },

    moveTooltip(e) {
        this.tooltipEl.style.left = `${e.pageX + 15}px`;
        this.tooltipEl.style.top = `${e.pageY + 15}px`;
    },

    hideTooltip() {
        this.tooltipEl.style.display = 'none';
    }
};