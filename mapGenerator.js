const constants = require('./constants');

function generateMap(gameState) {
    const CFG = constants.MAP_GEN; // Shortcut

    // 1. Reset to Plains
    for (let y = 0; y < constants.GRID_SIZE; y++) {
        for (let x = 0; x < constants.GRID_SIZE; x++) {
            gameState.terrainMap[y][x] = constants.TERRAIN.PLAINS;
        }
    }

    const isValidZone = (x, y) =>
        x >= 0 && x < constants.GRID_SIZE &&
        y >= CFG.SPAWN_ZONE_HEIGHT &&
        y < constants.GRID_SIZE - CFG.SPAWN_ZONE_HEIGHT;

    // Helper to detect if a cell is a street safely
    const isStreet = (gx, gy) => {
        if (gx < 0 || gx >= constants.GRID_SIZE || gy < 0 || gy >= constants.GRID_SIZE) return false;
        return gameState.terrainMap[gy][gx].id === 'street';
    };

    // Helper to check if placing a street at (tx, ty) creates a 2x2 blob
    const causesBlob = (tx, ty) => {
        // Check 4 potential 2x2 squares involving this cell
        // 1. Top-Left neighbor block (checking cell is Bottom-Right of 2x2)
        if (isStreet(tx-1, ty) && isStreet(tx-1, ty-1) && isStreet(tx, ty-1)) return true;
        // 2. Top-Right neighbor block (checking cell is Bottom-Left of 2x2)
        if (isStreet(tx+1, ty) && isStreet(tx+1, ty-1) && isStreet(tx, ty-1)) return true;
        // 3. Bottom-Left neighbor block (checking cell is Top-Right of 2x2)
        if (isStreet(tx-1, ty) && isStreet(tx-1, ty+1) && isStreet(tx, ty+1)) return true;
        // 4. Bottom-Right neighbor block (checking cell is Top-Left of 2x2)
        if (isStreet(tx+1, ty) && isStreet(tx+1, ty+1) && isStreet(tx, ty+1)) return true;

        return false;
    };

    const areaScale = (constants.GRID_SIZE * constants.GRID_SIZE) / CFG.BASE_AREA;

    // 2. STREETS
    const numStreets = Math.floor(Math.random() * CFG.STREETS.BASE_VAR) + CFG.STREETS.BASE_MIN;
    const totalStreets = Math.floor(numStreets * Math.sqrt(areaScale));

    for(let i=0; i<totalStreets; i++) {
        let x = Math.floor(Math.random() * constants.GRID_SIZE);
        let y = Math.floor(Math.random() * constants.GRID_SIZE);

        let length = Math.floor(constants.GRID_SIZE * CFG.STREETS.LENGTH_FACTOR);

        // Pick a random direction (8-way)
        let dx = 0;
        let dy = 0;
        while(dx === 0 && dy === 0) {
            dx = Math.floor(Math.random() * 3) - 1; // -1, 0, 1
            dy = Math.floor(Math.random() * 3) - 1; // -1, 0, 1
        }

        for(let j=0; j<length; j++) {
            // Only place street if it's in valid zone AND doesn't create a 2x2 blob
            if(isValidZone(x, y) && !causesBlob(x, y)) {
                gameState.terrainMap[y][x] = constants.TERRAIN.STREET;
            }

            x += dx;
            y += dy;

            // Stop if we go out of bounds (prevents clustering at edges)
            if (x < 0 || x >= constants.GRID_SIZE || y < 0 || y >= constants.GRID_SIZE) break;
        }
    }

    // 2.5 STREET ANTIALIASING (Ensuring Connectivity)
    // Iterate to find diagonal street gaps and fill them
    for (let y = 0; y < constants.GRID_SIZE - 1; y++) {
        for (let x = 0; x < constants.GRID_SIZE - 1; x++) {
            // Check 2x2 block
            const tl = gameState.terrainMap[y][x].id === 'street';     // Top-Left
            const tr = gameState.terrainMap[y][x+1].id === 'street';   // Top-Right
            const bl = gameState.terrainMap[y+1][x].id === 'street';   // Bottom-Left
            const br = gameState.terrainMap[y+1][x+1].id === 'street'; // Bottom-Right

            // Case 1: Diagonal \ (TL and BR are streets, but TR and BL are not)
            if (tl && br && !tr && !bl) {
                // Fill one corner to connect them. We check validity (spawn zone) before placing.
                if (isValidZone(x + 1, y)) {
                    gameState.terrainMap[y][x+1] = constants.TERRAIN.STREET;
                } else if (isValidZone(x, y + 1)) {
                    gameState.terrainMap[y+1][x] = constants.TERRAIN.STREET;
                }
            }

            // Case 2: Diagonal / (TR and BL are streets, but TL and BR are not)
            if (tr && bl && !tl && !br) {
                if (isValidZone(x, y)) {
                    gameState.terrainMap[y][x] = constants.TERRAIN.STREET;
                } else if (isValidZone(x + 1, y + 1)) {
                    gameState.terrainMap[y+1][x+1] = constants.TERRAIN.STREET;
                }
            }
        }
    }

    // 3. MOUNTAINS
    const baseMountains = Math.floor(Math.random() * CFG.MOUNTAINS.BASE_VAR) + CFG.MOUNTAINS.BASE_MIN;
    const targetMountainGroups = Math.floor(baseMountains * areaScale * CFG.MOUNTAINS.DENSITY);

    let mountainAttempts = 0;
    let groupsPlaced = 0;

    while(groupsPlaced < targetMountainGroups && mountainAttempts < (CFG.MOUNTAINS.MAX_ATTEMPTS_SCALE * areaScale)) {
        mountainAttempts++;
        const size = Math.random() < 0.5 ? CFG.MOUNTAINS.GROUP_SIZE_SMALL : CFG.MOUNTAINS.GROUP_SIZE_LARGE;

        const mx = Math.floor(Math.random() * (constants.GRID_SIZE - size - 2)) + 1;
        const my = Math.floor(Math.random() * (constants.GRID_SIZE - size - (CFG.SPAWN_ZONE_HEIGHT * 2 + 2))) + (CFG.SPAWN_ZONE_HEIGHT + 1);

        let canPlace = true;
        // Check buffer zone
        for (let y = my - 1; y < my + size + 1; y++) {
            for (let x = mx - 1; x < mx + size + 1; x++) {
                if (y >= 0 && y < constants.GRID_SIZE && x >= 0 && x < constants.GRID_SIZE) {
                    if (gameState.terrainMap[y][x].id === 'mountain') {
                        canPlace = false;
                        break;
                    }
                }
            }
            if (!canPlace) break;
        }

        if (canPlace) {
            for (let y = my; y < my + size; y++) {
                for (let x = mx; x < mx + size; x++) {
                    if (isValidZone(x, y)) {
                        gameState.terrainMap[y][x] = constants.TERRAIN.MOUNTAIN;
                    }
                }
            }
            groupsPlaced++;
        }
    }

    // 4. WALLS
    const baseWalls = Math.floor(Math.random() * CFG.WALLS.BASE_VAR) + CFG.WALLS.BASE_MIN;
    const numWalls = Math.floor(baseWalls * areaScale * CFG.WALLS.DENSITY);

    for (let i = 0; i < numWalls; i++) {
        let startX = Math.floor(Math.random() * constants.GRID_SIZE);
        let startY = Math.floor(Math.random() * (constants.GRID_SIZE - (CFG.SPAWN_ZONE_HEIGHT * 2))) + CFG.SPAWN_ZONE_HEIGHT;
        let isVertical = Math.random() < 0.5;
        let length = Math.floor(Math.random() * CFG.WALLS.LENGTH_VAR) + CFG.WALLS.LENGTH_MIN;

        for (let l = 0; l < length; l++) {
            let wx = isVertical ? startX : startX + l;
            let wy = isVertical ? startY + l : startY;

            if (isValidZone(wx, wy) && (gameState.terrainMap[wy][wx].id === 'plains' || gameState.terrainMap[wy][wx].id === 'street')) {
                gameState.terrainMap[wy][wx] = constants.TERRAIN.WALL;
            }
        }
    }

    // 5. FORESTS
    const baseForests = Math.floor(Math.random() * CFG.FORESTS.BASE_VAR) + CFG.FORESTS.BASE_MIN;
    const numForests = Math.floor(baseForests * areaScale * CFG.FORESTS.DENSITY);

    for (let i = 0; i < numForests; i++) {
        let cx = Math.floor(Math.random() * constants.GRID_SIZE);
        let cy = Math.floor(Math.random() * (constants.GRID_SIZE - (CFG.SPAWN_ZONE_HEIGHT * 2))) + CFG.SPAWN_ZONE_HEIGHT;

        if (isValidZone(cx, cy)) {
            const blobSize = Math.floor(Math.random() * CFG.FORESTS.BLOB_SIZE_VAR) + CFG.FORESTS.BLOB_SIZE_MIN;
            let openSet = [{x: cx, y: cy}];
            let placedCount = 0;

            while(placedCount < blobSize && openSet.length > 0) {
                let idx = Math.floor(Math.random() * openSet.length);
                let current = openSet.splice(idx, 1)[0];

                if (isValidZone(current.x, current.y)) {
                    if (gameState.terrainMap[current.y][current.x].id === 'plains' || gameState.terrainMap[current.y][current.x].id === 'street') {
                        gameState.terrainMap[current.y][current.x] = constants.TERRAIN.FOREST;
                        placedCount++;
                        [{dx:0, dy:1}, {dx:0, dy:-1}, {dx:1, dy:0}, {dx:-1, dy:0}].forEach(({dx, dy}) => {
                            openSet.push({x: current.x + dx, y: current.y + dy});
                        });
                    }
                }
            }
        }
    }

    // 6. RIVERS
    const numRivers = Math.max(1, Math.floor(areaScale * CFG.RIVERS.DENSITY));
    for(let r=0; r<numRivers; r++) {
        let rx = Math.floor(Math.random() * constants.GRID_SIZE);
        let ry = Math.floor(Math.random() * (constants.GRID_SIZE - (CFG.SPAWN_ZONE_HEIGHT * 2))) + CFG.SPAWN_ZONE_HEIGHT;
        let riverLength = Math.floor(constants.GRID_SIZE * CFG.RIVERS.LENGTH_FACTOR);

        for(let i=0; i<riverLength; i++) {
            if (isValidZone(rx, ry)) {
                if (gameState.terrainMap[ry][rx].id !== 'mountain') {
                    gameState.terrainMap[ry][rx] = constants.TERRAIN.WATER;
                }
            }
            let move = Math.random();
            if (move < 0.5) rx += (Math.random() < 0.5 ? 1 : -1);
            else ry += (Math.random() < 0.5 ? 1 : -1);
        }
    }
}

module.exports = { generateMap };