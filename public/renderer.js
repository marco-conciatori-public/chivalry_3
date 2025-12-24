// RENDERER: Handles all Canvas Drawing operations
const Renderer = {
    // Constants injected from Main
    GRID_SIZE: 10,
    CELL_SIZE: 0,
    ctx: null,
    icons: {
        knight: '⚔️',
        archer: '🏹',
        wizard: '🧙',
        scout: '🏇'
    },

    init(ctx, gridSize, canvasWidth) {
        this.ctx = ctx;
        this.GRID_SIZE = gridSize;
        this.CELL_SIZE = canvasWidth / gridSize;
    },

    setGridSize(size, canvasWidth) {
        this.GRID_SIZE = size;
        this.CELL_SIZE = canvasWidth / size;
    },

    draw(gameState, myId, selectedCell, interactionState, validMoves, validAttackTargets, cellsInAttackRange) {
        if (!gameState) return;

        this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

        // Dynamic Font
        const fontSize = Math.floor(this.CELL_SIZE * 0.7);

        for (let y = 0; y < this.GRID_SIZE; y++) {
            for (let x = 0; x < this.GRID_SIZE; x++) {
                // RENDER TERRAIN
                if (gameState.terrainMap) {
                    const terrain = gameState.terrainMap[y][x];
                    this.ctx.fillStyle = terrain.color;
                    this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);

                    if (terrain.symbol) {
                        this.ctx.save();
                        this.ctx.globalAlpha = 0.3;
                        this.ctx.font = `${fontSize}px Arial`;
                        this.ctx.textAlign = "center";
                        this.ctx.textBaseline = "middle";
                        this.ctx.fillStyle = "#000";
                        this.ctx.fillText(terrain.symbol, x * this.CELL_SIZE + this.CELL_SIZE/2, y * this.CELL_SIZE + this.CELL_SIZE/2);
                        this.ctx.restore();
                    }
                }

                const entity = gameState.grid[y][x];

                // 1. Unit Background (Owner Color)
                if (entity) {
                    const ownerData = gameState.players[entity.owner];
                    const color = ownerData ? ownerData.color : '#999';
                    this.ctx.globalAlpha = 0.4;
                    this.ctx.fillStyle = color;
                    this.ctx.fillRect(x * this.CELL_SIZE + 2, y * this.CELL_SIZE + 2, this.CELL_SIZE - 4, this.CELL_SIZE - 4);
                    this.ctx.globalAlpha = 1.0;
                }

                // 2. Selection Highlight
                if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
                    this.ctx.fillStyle = "rgba(255, 215, 0, 0.4)";
                    this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                    this.ctx.strokeStyle = "gold";
                    this.ctx.lineWidth = 3;
                    this.ctx.strokeRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                    this.ctx.lineWidth = 1;
                }

                // 3. Overlays
                if (interactionState === 'ROTATING' && selectedCell) {
                    const dx = x - selectedCell.x;
                    const dy = y - selectedCell.y;
                    if (Math.abs(dx) + Math.abs(dy) === 1) {
                        this.drawRotationArrow(x, y, dx, dy);
                    }
                }
                else if (interactionState === 'ATTACK_TARGETING') {
                    const isInRange = cellsInAttackRange.some(c => c.x === x && c.y === y);
                    if (isInRange) {
                        this.ctx.fillStyle = "rgba(255, 0, 0, 0.2)";
                        this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                    }
                    const isTarget = validAttackTargets.some(t => t.x === x && t.y === y);
                    if (isTarget) {
                        this.ctx.strokeStyle = "red";
                        this.ctx.lineWidth = 3;
                        this.ctx.setLineDash([5, 5]);
                        this.ctx.strokeRect(x * this.CELL_SIZE + 2, y * this.CELL_SIZE + 2, this.CELL_SIZE - 4, this.CELL_SIZE - 4);
                        this.ctx.setLineDash([]);
                        this.ctx.lineWidth = 1;
                    }
                }
                else if (interactionState === 'SELECTED' || interactionState === 'MENU') {
                    const isReachable = validMoves.some(m => m.x === x && m.y === y);
                    if (selectedCell && isReachable && !entity) {
                        this.ctx.fillStyle = "rgba(46, 204, 113, 0.4)";
                        this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                        this.ctx.beginPath();
                        this.ctx.arc(x * this.CELL_SIZE + this.CELL_SIZE/2, y * this.CELL_SIZE + this.CELL_SIZE/2, 4, 0, Math.PI * 2);
                        this.ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
                        this.ctx.fill();
                    }
                }

                this.ctx.strokeStyle = "rgba(0,0,0,0.1)";
                this.ctx.strokeRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);

                // 5. Entity Icon
                if (entity) {
                    if (entity.remainingMovement <= 0 && entity.hasAttacked) {
                        this.ctx.globalAlpha = 0.5;
                    }

                    this.ctx.fillStyle = "#000";
                    this.ctx.font = `${fontSize + 2}px Arial`;
                    this.ctx.textAlign = "center";
                    this.ctx.textBaseline = "middle";
                    const icon = this.icons[entity.type] || '❓';
                    const centerX = x * this.CELL_SIZE + (this.CELL_SIZE / 2);
                    const centerY = y * this.CELL_SIZE + (this.CELL_SIZE / 2);

                    this.ctx.fillText(icon, centerX, centerY);

                    if (entity.is_commander) {
                        this.ctx.font = `${fontSize * 0.6}px Arial`;
                        this.ctx.fillText("👑", centerX, centerY - (fontSize * 0.6));
                    }

                    if (entity.is_fleeing) {
                        this.ctx.font = `${fontSize * 0.6}px Arial`;
                        this.ctx.fillText("🏳️", centerX + (fontSize * 0.5), centerY - (fontSize * 0.5));
                    }

                    this.drawFacingIndicator(x, y, entity.facing_direction, entity.remainingMovement > 0);
                    this.drawHealthBar(x, y, entity.current_health, entity.max_health);

                    this.ctx.globalAlpha = 1.0;
                }
            }
        }
    },

    drawFacingIndicator(gridX, gridY, direction, isActive) {
        const cx = gridX * this.CELL_SIZE + (this.CELL_SIZE / 2);
        const cy = gridY * this.CELL_SIZE + (this.CELL_SIZE / 2);
        const radius = this.CELL_SIZE / 2.2;

        this.ctx.save();
        this.ctx.translate(cx, cy);

        let rotation = 0;
        if (direction === 0) rotation = -Math.PI / 2;
        if (direction === 2) rotation = 0;
        if (direction === 4) rotation = Math.PI / 2;
        if (direction === 6) rotation = Math.PI;

        this.ctx.rotate(rotation);
        this.ctx.beginPath();
        this.ctx.moveTo(radius, 0);
        this.ctx.lineTo(radius - 8, -6);
        this.ctx.lineTo(radius - 8, 6);
        this.ctx.closePath();
        this.ctx.fillStyle = isActive ? "#FFD700" : "#555";
        this.ctx.fill();
        this.ctx.strokeStyle = "#000";
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        this.ctx.restore();
    },

    drawRotationArrow(gridX, gridY, dx, dy) {
        const cx = gridX * this.CELL_SIZE + (this.CELL_SIZE / 2);
        const cy = gridY * this.CELL_SIZE + (this.CELL_SIZE / 2);

        this.ctx.save();
        this.ctx.translate(cx, cy);

        let rotation = 0;
        if (dx === 1) rotation = 0;
        if (dx === -1) rotation = Math.PI;
        if (dy === 1) rotation = Math.PI/2;
        if (dy === -1) rotation = -Math.PI/2;

        this.ctx.rotate(rotation);
        this.ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        this.ctx.beginPath();
        this.ctx.moveTo(10, 0);
        this.ctx.lineTo(-5, 7);
        this.ctx.lineTo(-5, -7);
        this.ctx.fill();
        this.ctx.restore();
    },

    drawHealthBar(gridX, gridY, current, max) {
        const barWidth = this.CELL_SIZE - 4;
        const barHeight = 2;
        const x = gridX * this.CELL_SIZE + 2;
        const y = gridY * this.CELL_SIZE + this.CELL_SIZE - 4;
        const pct = Math.max(0, current / max);
        this.ctx.fillStyle = "red";
        this.ctx.fillRect(x, y, barWidth, barHeight);
        this.ctx.fillStyle = "#2ecc71";
        this.ctx.fillRect(x, y, barWidth * pct, barHeight);
    }
};