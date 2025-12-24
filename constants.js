module.exports = {
    // Game Grid
    GRID_SIZE: 10,

    // Player Configuration
    PLAYER_COLORS: ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6'],
    STARTING_GOLD: 2000,

    // Combat Mechanics
    BONUS_DAMAGE: 20,
    BONUS_SHIELD: 20,
    MIN_DAMAGE_REDUCTION_BY_HEALTH: 0.2,
    MAX_DAMAGE_REDUCTION_BY_DEFENSE: 0.1,
    DAMAGE_RANDOM_BASE: 0.8,
    DAMAGE_RANDOM_VARIANCE: 0.4,

    // Morale Mechanics
    MORALE_THRESHOLD: 30,
    MAX_MORALE: 100,
    COMMANDER_INFLUENCE_RANGE: 4,

    // TERRAIN DEFINITIONS
    TERRAIN: {
        PLAINS: { id: 'plains', symbol: '', cost: 1, defense: 0, blocksLos: false, color: '#a3d5a5' },
        FOREST: { id: 'forest', symbol: '🌲', cost: 2, defense: 20, blocksLos: true, color: '#a3d5a5' },
        MOUNTAIN: { id: 'mountain', symbol: '🏔️', cost: 3, defense: 30, blocksLos: true, color: '#bdc3c7', highGround: true },
        WALL: { id: 'wall', symbol: '🧱', cost: 99, defense: 0, blocksLos: true, color: '#7f8c8d', highGround: true },
        WATER: { id: 'water', symbol: '🌊', cost: 99, defense: 0, blocksLos: false, color: '#85c1e9' }
    }
};