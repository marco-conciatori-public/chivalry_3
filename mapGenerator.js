const constants = require('./constants');

function generateMap(gameState) {
    // Read constants inside function to ensure dynamic updates from Server are caught
    const GRID_SIZE = constants.GRID_SIZE;
    const CFG = constants.MAP_GEN;

    // 1. Reset to Plains
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            gameState.terrainMap[y][x] = constants.TERRAIN.PLAINS;
        }
    }

    // --- NEW VALID ZONE LOGIC FOR 4 PLAYERS ---
    const G = GRID_SIZE;
    const dimLong = Math.floor(G / 2);
    const dimShort = Math.floor(G / 20);
    const centerOffset = Math.floor((G - dimLong) / 2);

    // Define the 4 forbidden base rectangles
    const bases = [
        { x: centerOffset, y: 0, w: dimLong, h: dimShort },           // P1 (Top)
        { x: centerOffset, y: G - dimShort, w: dimLong, h: dimShort }, // P2 (Bottom)
        { x: 0, y: centerOffset, w: dimShort, h: dimLong },           // P3 (Left)
        { x: G - dimShort, y: centerOffset, w: dimShort, h: dimLong }  // P4 (Right)
    ];

    const isValidZone = (x, y) => {
        // Check map bounds
        if (x < 0 || x >= G || y < 0 || y >= G) return false;
        // Check spawn buffer (generic top/bottom buffer from constants if needed, but we rely on bases now)
        if (y < CFG.SPAWN_ZONE_HEIGHT || y >= G - CFG.SPAWN_ZONE_HEIGHT) return false;

        // Check against any base area
        for (let b of bases) {
            if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) {
                return false;
            }
        }
        return true;
    };

    const areaScale = (GRID_SIZE * GRID_SIZE) / CFG.BASE_AREA;

    // --- GENERATE OBSTACLES FIRST ---

    // 2. MOUNTAINS
    const baseMountains = Math.floor(Math.random() * CFG.MOUNTAINS.BASE_VAR) + CFG.MOUNTAINS.BASE_MIN;
    const targetMountainGroups = Math.floor(baseMountains * areaScale * CFG.MOUNTAINS.DENSITY);

    let mountainAttempts = 0;
    let groupsPlaced = 0;

    while (groupsPlaced < targetMountainGroups && mountainAttempts < (CFG.MOUNTAINS.MAX_ATTEMPTS_SCALE * areaScale)) {
        mountainAttempts++;

        const maxSize = Math.ceil(Math.log(GRID_SIZE));
        const effectiveMax = Math.max(maxSize, CFG.MOUNTAINS.GROUP_SIZE_SMALL);
        const size = Math.floor(Math.random() * (effectiveMax - CFG.MOUNTAINS.GROUP_SIZE_SMALL + 1)) + CFG.MOUNTAINS.GROUP_SIZE_SMALL;

        const mx = Math.floor(Math.random() * (GRID_SIZE - size - 2)) + 1;
        const my = Math.floor(Math.random() * (GRID_SIZE - size - 2)) + 1;

        let canPlace = true;
        for (let y = my - 1; y < my + size + 1; y++) {
            for (let x = mx - 1; x < mx + size + 1; x++) {
                if (y >= 0 && y < GRID_SIZE && x >= 0 && x < GRID_SIZE) {
                    if (!isValidZone(x, y)) {
                        canPlace = false;
                        break;
                    }
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
                    gameState.terrainMap[y][x] = constants.TERRAIN.MOUNTAIN;
                }
            }
            groupsPlaced++;
        }
    }

    // 3. WALLS
    const baseWalls = Math.floor(Math.random() * CFG.WALLS.BASE_VAR) + CFG.WALLS.BASE_MIN;
    const numWalls = Math.floor(baseWalls * areaScale * CFG.WALLS.DENSITY);

    for (let i = 0; i < numWalls; i++) {
        let startX = Math.floor(Math.random() * GRID_SIZE);
        let startY = Math.floor(Math.random() * GRID_SIZE);
        let isVertical = Math.random() < 0.5;
        let length = Math.floor(Math.random() * CFG.WALLS.LENGTH_VAR) + CFG.WALLS.LENGTH_MIN;

        for (let l = 0; l < length; l++) {
            let wx = isVertical ? startX : startX + l;
            let wy = isVertical ? startY + l : startY;

            if (isValidZone(wx, wy) && (gameState.terrainMap[wy][wx].id === 'plains')) {
                gameState.terrainMap[wy][wx] = constants.TERRAIN.WALL;
            }
        }
    }

    // 4. FORESTS
    const baseForests = Math.floor(Math.random() * CFG.FORESTS.BASE_VAR) + CFG.FORESTS.BASE_MIN;
    const numForests = Math.floor(baseForests * areaScale * CFG.FORESTS.DENSITY);

    for (let i = 0; i < numForests; i++) {
        let cx = Math.floor(Math.random() * GRID_SIZE);
        let cy = Math.floor(Math.random() * GRID_SIZE);

        if (isValidZone(cx, cy)) {
            const blobSize = Math.floor(Math.random() * CFG.FORESTS.BLOB_SIZE_VAR) + CFG.FORESTS.BLOB_SIZE_MIN;
            let openSet = [{x: cx, y: cy}];
            let placedCount = 0;

            while(placedCount < blobSize && openSet.length > 0) {
                let idx = Math.floor(Math.random() * openSet.length);
                let current = openSet.splice(idx, 1)[0];

                if (isValidZone(current.x, current.y)) {
                    if (gameState.terrainMap[current.y][current.x].id === 'plains') {
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

    // 5. RIVERS
    const numRivers = Math.max(1, Math.floor(areaScale * CFG.RIVERS.DENSITY));
    for(let r=0; r<numRivers; r++) {
        let rx = Math.floor(Math.random() * GRID_SIZE);
        let ry = Math.floor(Math.random() * GRID_SIZE);
        let riverLength = Math.floor(GRID_SIZE * CFG.RIVERS.LENGTH_FACTOR);

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

    // --- GENERATE STREETS LAST ---
    const isStreet = (gx, gy) => {
        if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) return false;
        return gameState.terrainMap[gy][gx].id === 'street';
    };

    const causesBlob = (tx, ty) => {
        if (isStreet(tx-1, ty) && isStreet(tx-1, ty-1) && isStreet(tx, ty-1)) return true;
        if (isStreet(tx+1, ty) && isStreet(tx+1, ty-1) && isStreet(tx, ty-1)) return true;
        if (isStreet(tx-1, ty) && isStreet(tx-1, ty+1) && isStreet(tx, ty+1)) return true;
        if (isStreet(tx+1, ty) && isStreet(tx+1, ty+1) && isStreet(tx, ty+1)) return true;
        return false;
    };

    const numStreets = Math.floor(Math.random() * CFG.STREETS.BASE_VAR) + CFG.STREETS.BASE_MIN;
    const totalStreets = Math.floor(numStreets * Math.sqrt(areaScale) * 0.6);

    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];

    for(let i=0; i<totalStreets; i++) {
        let x, y;
        let attempts = 0;
        let foundStart = false;
        while(attempts < 50 && !foundStart) {
            x = Math.floor(Math.random() * GRID_SIZE);
            y = Math.floor(Math.random() * GRID_SIZE);
            if (isValidZone(x, y) && gameState.terrainMap[y][x].id === 'plains') {
                foundStart = true;
            }
            attempts++;
        }
        if (!foundStart) continue;

        let length = Math.floor(GRID_SIZE * CFG.STREETS.LENGTH_FACTOR);
        let currentDir = dirs[Math.floor(Math.random() * dirs.length)];

        for(let j=0; j<length; j++) {
            if(isValidZone(x, y) && gameState.terrainMap[y][x].id === 'plains' && !causesBlob(x, y)) {
                gameState.terrainMap[y][x] = constants.TERRAIN.STREET;
            }
            let nextX = x + currentDir[0];
            let nextY = y + currentDir[1];
            let isBlocked = true;
            if (isValidZone(nextX, nextY)) {
                const target = gameState.terrainMap[nextY][nextX];
                if (target.id === 'plains' || target.id === 'street') isBlocked = false;
            }
            if (isBlocked || Math.random() < CFG.STREETS.TURN_BIAS) {
                let possibleDirs = [...dirs].sort(() => Math.random() - 0.5);
                let foundDir = false;
                for (let d of possibleDirs) {
                    let tx = x + d[0];
                    let ty = y + d[1];
                    if (isValidZone(tx, ty)) {
                        const t = gameState.terrainMap[ty][tx];
                        if (t.id === 'plains' || t.id === 'street') {
                            currentDir = d;
                            nextX = tx;
                            nextY = ty;
                            foundDir = true;
                            break;
                        }
                    }
                }
                if (!foundDir) break;
            }
            x = nextX;
            y = nextY;
        }
    }

    // 7. STREET ANTIALIASING
    for (let y = 0; y < GRID_SIZE - 1; y++) {
        for (let x = 0; x < GRID_SIZE - 1; x++) {
            const tl = gameState.terrainMap[y][x].id === 'street';
            const tr = gameState.terrainMap[y][x+1].id === 'street';
            const bl = gameState.terrainMap[y+1][x].id === 'street';
            const br = gameState.terrainMap[y+1][x+1].id === 'street';
            if (tl && br && !tr && !bl) {
                if (isValidZone(x + 1, y) && gameState.terrainMap[y][x+1].id === 'plains' && !causesBlob(x+1, y)) {
                    gameState.terrainMap[y][x+1] = constants.TERRAIN.STREET;
                } else if (isValidZone(x, y + 1) && gameState.terrainMap[y+1][x].id === 'plains' && !causesBlob(x, y+1)) {
                    gameState.terrainMap[y+1][x] = constants.TERRAIN.STREET;
                }
            }
            if (tr && bl && !tl && !br) {
                if (isValidZone(x, y) && gameState.terrainMap[y][x].id === 'plains' && !causesBlob(x, y)) {
                    gameState.terrainMap[y][x] = constants.TERRAIN.STREET;
                } else if (isValidZone(x + 1, y + 1) && gameState.terrainMap[y+1][x+1].id === 'plains' && !causesBlob(x+1, y+1)) {
                    gameState.terrainMap[y+1][x+1] = constants.TERRAIN.STREET;
                }
            }
        }
    }
}

module.exports = { generateMap };